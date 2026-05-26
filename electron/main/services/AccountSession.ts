/**
 * 账号会话管理
 *
 * @see docs/live-control-lifecycle-spec.md 中控台与直播状态管理总规范
 *
 * 核心规则：
 * - 停止所有任务 ≠ 断开中控台连接
 * - 结束直播 ≠ 断开中控台连接
 * - 断开中控台连接 ≠ 关闭浏览器
 * - 可见模式关播不停止 StreamStateDetector；无头模式关播可释放浏览器资源
 */

import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { isBrowserClosedReason } from 'shared/liveControlDisconnect'
import type { StreamStatus } from 'shared/streamStatus'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { platformFactory } from '#/platforms'
import { type IPlatform, isBrowserlessRuntimePlatform } from '#/platforms/IPlatform'
import type { ReconnectReason } from '#/services/ReconnectManager'
import { StreamStateDetector } from '#/services/StreamStateDetector'
import type { ITask } from '#/tasks/ITask'
import windowManager from '#/windowManager'
import {
  closeAccountSessionBrowserSession,
  ensureAccountSessionAuthenticated,
  finalizeAccountSessionConnection,
  launchAccountSessionBrowserSession,
  parseAccountSessionStorageState,
  reconnectAccountSession,
} from './accountSessionConnectFlow'
import {
  formatAccountSessionConnectError,
  verifyAccountSessionConnectionHealth,
} from './accountSessionConnectionHelpers'
import {
  disconnectAccountSession,
  handleAccountSessionStreamEnded,
  stopAccountSessionTasksAndUpdateState,
} from './accountSessionDisconnect'
import {
  getAccountSessionCurrentUrl,
  getAccountSessionLiveRoomUrl,
  isAccountSessionAuthExpired,
} from './accountSessionPageInfo'
import {
  fetchAccountSessionAutoPopupGoodsIds,
  fetchAccountSessionAutoPopupGoodsMeta,
  getActiveAccountSessionTaskTypes,
  scanAccountSessionAutoPopupGoodsKnowledge,
  sendAccountSessionComment,
  startAccountSessionTask,
  stopAccountSessionTask,
  updateAccountSessionTaskConfig,
} from './accountSessionTaskOps'

const BROWSER_LAUNCH_TIMEOUT_MS = 30_000
const LOGIN_TIMEOUT_MS = 180_000
const SESSION_VERIFY_TIMEOUT_MS = 20_000
const TAOBAO_SESSION_VERIFY_TIMEOUT_MS = 60_000
const OFFLINE_IDLE_SLEEP_MS = 5 * 60 * 1000

export class AccountSession {
  private readonly platformId: LiveControlPlatform
  private platform: IPlatform
  private browserSession: BrowserSession | null = null
  private activeTasks: Map<LiveControlTask['type'], ITask> = new Map()
  private streamStateDetector: StreamStateDetector
  // 【修复】添加标记防止重复触发 disconnect
  private isDisconnecting = false
  private isDisconnected = false
  private isWaitingForLogin = false
  private unbindBrowserEvents: (() => void) | null = null
  private idleSleepTimer: NodeJS.Timeout | null = null
  private isIdleSleeping = false
  private autoStartOnLiveEnabled = false

  constructor(
    platformName: LiveControlPlatform,
    private account: Account,
    private logger = createLogger(`@${account.name}`),
  ) {
    this.platformId = platformName
    this.account = {
      ...account,
      platform: platformName,
    }
    this.platform = new platformFactory[platformName]()
    this.streamStateDetector = new StreamStateDetector(
      this.platform,
      this.browserSession,
      this.account.id,
      this.logger.scope('StreamState'),
    )
    // 【核心修复】设置直播结束回调 - 当检测到关播时只停止任务，不断开中控台
    this.streamStateDetector.setOnStreamEndedCallback((reason: string) => {
      this.logger.info(`[StreamState] Stream ended callback triggered: ${reason}`)
      // 关播时只停止任务，不断开中控台，不关闭浏览器，不发送 disconnectedEvent
      void this.stopForStreamEnded(reason)
    })
    this.streamStateDetector.setOnStateChangedCallback(state => {
      this.handleStreamStateChanged(state)
    })
  }

  private async runStopTasksAndUpdateState(
    reason: string,
    options: {
      closeBrowser: boolean
      sendDisconnectEvent: boolean
      stopDetector: boolean
    },
  ) {
    return await stopAccountSessionTasksAndUpdateState({
      accountId: this.account.id,
      reason,
      closeBrowser: options.closeBrowser,
      sendDisconnectEvent: options.sendDisconnectEvent,
      stopDetector: options.stopDetector,
      activeTasks: this.activeTasks,
      streamStateDetector: this.streamStateDetector,
      logger: this.logger,
      emitConnectionState: connectState => this.emitConnectionState(connectState),
      withTimeout: (promise, timeoutMs, message) => this.withTimeout(promise, timeoutMs, message),
      getBrowserSession: () => this.browserSession,
      setBrowserSession: session => {
        this.browserSession = session
      },
    })
  }

  private emitConnectionState(
    connectState: Partial<{
      status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
      phase:
        | 'idle'
        | 'preparing'
        | 'recovering'
        | 'launching_browser'
        | 'waiting_for_login'
        | 'verifying_session'
        | 'streaming'
        | 'tasks_running'
        | 'error'
      error: string | null
      session: string | null
      lastVerifiedAt: number | null
    }>,
  ) {
    windowManager.send(IPC_CHANNELS.tasks.liveControl.stateChanged, {
      accountId: this.account.id,
      connectState,
    })
  }

  private clearBrowserEventBindings(): void {
    if (!this.unbindBrowserEvents) {
      return
    }

    try {
      this.unbindBrowserEvents()
    } catch (error) {
      this.logger.warn('[browser-events] 清理浏览器事件监听失败：', error)
    } finally {
      this.unbindBrowserEvents = null
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  async connect(config: {
    headless?: boolean
    storageState?: string
    suppressTerminalStateOnFailure?: boolean
  }): Promise<{ needsLogin: boolean; accountName?: string | null; streamState: StreamStatus }> {
    const suppressTerminalStateOnFailure = config.suppressTerminalStateOnFailure ?? false

    try {
      this.cancelIdleSleep('connect')
      this.isIdleSleeping = false
      this.isDisconnecting = false
      this.isDisconnected = false
      this.isWaitingForLogin = false
      this.clearBrowserEventBindings()
      const headless = config.headless ?? false
      console.log('[BrowserPopup] [AccountSession] connect() called', {
        accountId: this.account.id,
        headless,
        hasStorageState: !!config.storageState,
      })
      this.emitConnectionState({
        status: 'connecting',
        phase: 'preparing',
        error: null,
        session: null,
        lastVerifiedAt: null,
      })
      const storageState = parseAccountSessionStorageState(config.storageState, this.logger)

      console.log('[BrowserPopup] [AccountSession] Calling browserManager.createSession()')
      this.browserSession = await launchAccountSessionBrowserSession({
        accountId: this.account.id,
        platformId: this.platformId,
        headless,
        storageState,
        logger: this.logger,
        emitConnectionState: connectState => this.emitConnectionState(connectState),
        withTimeout: (promise, timeoutMs, message) => this.withTimeout(promise, timeoutMs, message),
        timeouts: {
          browserLaunchMs: BROWSER_LAUNCH_TIMEOUT_MS,
        },
      })
      console.log(
        `[BrowserPopup] [AccountSession] createSession() returned, browser exists: ${!!this.browserSession?.browser}`,
      )
      this.streamStateDetector.updateBrowserSession(this.browserSession)

      console.log('[BrowserPopup] [AccountSession] Calling ensureAuthenticated()')
      const needsLogin = await this.ensureAuthenticated(this.browserSession, headless)
      console.log(
        `[BrowserPopup] [AccountSession] ensureAuthenticated() returned, needsLogin: ${needsLogin}`,
      )

      const browserSession = this.browserSession
      if (!browserSession) {
        throw new Error('浏览器会话不存在')
      }

      const finalizeResult = await finalizeAccountSessionConnection({
        browserSession,
        accountId: this.account.id,
        platformId: this.platformId,
        platform: this.platform,
        fallbackAccountName: `${this.account.name}(未获取)`,
        logger: this.logger,
        streamStateDetector: this.streamStateDetector,
        isDisconnecting: () => this.isDisconnecting,
        isDisconnected: () => this.isDisconnected,
        isAuthExpired: url => this.isAuthExpired(url),
        emitConnectionState: connectState => this.emitConnectionState(connectState),
        verifyConnectionHealth: () => this.verifyConnectionHealth(),
        onPageClosed: reason => {
          emitter.emit('page-closed', { accountId: this.account.id, reason })
        },
      })
      this.unbindBrowserEvents = finalizeResult.unbindBrowserEvents
      await this.parkHeadlessBrowserForBrowserlessRuntime(headless)

      return {
        needsLogin,
        accountName: finalizeResult.accountName,
        streamState: this.streamStateDetector.getCurrentState(),
      }
    } catch (error) {
      const message = this.formatConnectError(error)
      this.logger.error('连接直播控制台失败：', error)
      const isBrowserClosed = isBrowserClosedReason(message)
      if (!suppressTerminalStateOnFailure) {
        this.emitConnectionState({
          status: isBrowserClosed ? 'disconnected' : 'error',
          phase: isBrowserClosed ? 'idle' : 'error',
          error: message,
          session: null,
          lastVerifiedAt: null,
        })
      }
      throw new Error(message)
    }
  }

  /**
   * 【新增】验证连接健康状态
   * 确保直播状态检测可以正常工作，避免"假连接"状态
   */
  private async verifyConnectionHealth(): Promise<{ healthy: boolean; reason?: string }> {
    return await verifyAccountSessionConnectionHealth(
      this.browserSession,
      this.platform,
      this.logger,
    )
  }

  /**
   * 关播时调用：只停止任务，不断开中控台，不关闭浏览器，不发送 disconnectedEvent
   *
   * 可见模式继续保活 StreamStateDetector；无头模式释放浏览器资源并在下次任务启动时恢复。
   */
  async stopForStreamEnded(reason: string): Promise<void> {
    const releaseHeadlessBrowser = this.browserSession?.isHeadless === true
    if (releaseHeadlessBrowser) {
      this.logger.info('[stopForStreamEnded] Headless session will release browser resources')
    }

    await handleAccountSessionStreamEnded({
      accountId: this.account.id,
      reason,
      logger: this.logger,
      streamStateDetector: this.streamStateDetector,
      keepDetectorAlive: !releaseHeadlessBrowser,
      isDisconnecting: () => this.isDisconnecting,
      setDisconnecting: disconnecting => {
        this.isDisconnecting = disconnecting
      },
      stopTasksForStreamEnded: () =>
        this.runStopTasksAndUpdateState(reason, {
          closeBrowser: releaseHeadlessBrowser,
          sendDisconnectEvent: false,
          stopDetector: releaseHeadlessBrowser,
        }),
    })
    if (releaseHeadlessBrowser && !this.browserSession) {
      this.clearBrowserEventBindings()
    }
    this.scheduleOfflineIdleSleep('stream-ended')
  }

  /**
   * 断开中控台：停止任务，更新状态，发送 disconnectedEvent
   *
   * @param reason 断开原因
   * @param options.closeBrowser 是否关闭浏览器（默认 false，只有浏览器实际关闭时才传 true）
   */
  async disconnect(reason?: string, options?: { closeBrowser?: boolean }): Promise<void> {
    this.cancelIdleSleep('disconnect')
    await disconnectAccountSession({
      accountId: this.account.id,
      reason,
      shouldCloseBrowser: options?.closeBrowser ?? false,
      logger: this.logger,
      isDisconnecting: () => this.isDisconnecting,
      isDisconnected: () => this.isDisconnected,
      isWaitingForLogin: () => this.isWaitingForLogin,
      setDisconnecting: disconnecting => {
        this.isDisconnecting = disconnecting
      },
      setDisconnected: disconnected => {
        this.isDisconnected = disconnected
      },
      setWaitingForLogin: waiting => {
        this.isWaitingForLogin = waiting
      },
      activeTasksCount: () => this.activeTasks.size,
      stopTasksForDisconnect: (disconnectReason, shouldCloseBrowser) =>
        this.runStopTasksAndUpdateState(disconnectReason, {
          closeBrowser: shouldCloseBrowser,
          sendDisconnectEvent: true,
          stopDetector: true,
        }),
    })
    if (this.isDisconnected) {
      this.clearBrowserEventBindings()
    }
  }

  private async ensureAuthenticated(session: BrowserSession, headless = true): Promise<boolean> {
    const result = await ensureAccountSessionAuthenticated({
      accountId: this.account.id,
      platformId: this.platformId,
      session,
      headless,
      platform: this.platform,
      logger: this.logger,
      streamStateDetector: this.streamStateDetector,
      emitConnectionState: connectState => this.emitConnectionState(connectState),
      withTimeout: (promise, timeoutMs, message) => this.withTimeout(promise, timeoutMs, message),
      setBrowserSession: browserSession => {
        this.browserSession = browserSession
      },
      setWaitingForLogin: waiting => {
        this.isWaitingForLogin = waiting
      },
      timeouts: {
        browserLaunchMs: BROWSER_LAUNCH_TIMEOUT_MS,
        loginMs: LOGIN_TIMEOUT_MS,
        sessionVerifyMs:
          this.platformId === 'taobao'
            ? TAOBAO_SESSION_VERIFY_TIMEOUT_MS
            : SESSION_VERIFY_TIMEOUT_MS,
      },
    })

    this.browserSession = result.browserSession
    return result.needsLogin
  }

  private async parkHeadlessBrowserForBrowserlessRuntime(headless: boolean): Promise<void> {
    if (!headless || !this.browserSession || !isBrowserlessRuntimePlatform(this.platform)) {
      return
    }

    const session = this.browserSession
    const storageState = await session.context.storageState()
    const hydrated = await this.platform.hydrateBrowserlessRuntime({
      accountId: this.account.id,
      platformId: this.platformId,
      storageState,
      browserSession: session,
    })

    if (!hydrated) {
      return
    }

    this.logger.info('[browserless] 轻量运行时已就绪，释放常驻无头浏览器')
    this.clearBrowserEventBindings()
    this.browserSession = null
    this.streamStateDetector.updateBrowserSession(null)
    await closeAccountSessionBrowserSession(session, this.logger)
  }

  private formatConnectError(error: unknown) {
    let currentUrl: string | undefined
    try {
      currentUrl = this.browserSession?.page?.url()
    } catch {
      currentUrl = undefined
    }

    return formatAccountSessionConnectError(error, {
      platformName: this.platform?.platformName,
      currentUrl,
    })
  }

  public async startTask(task: LiveControlTask): Result.ResultAsync<void, Error> {
    this.wakeFromIdleSleep(`start-task:${task.type}`)
    const canStartWithoutBrowser =
      isBrowserlessRuntimePlatform(this.platform) &&
      this.platform.canStartTaskWithoutBrowser(task.type)

    if (!this.browserSession && !this.isDisconnected && !canStartWithoutBrowser) {
      this.logger.info(
        `[startTask][${this.account.id}] Browser session is idle, restoring headless session`,
      )
      try {
        await this.connect({
          headless: true,
          suppressTerminalStateOnFailure: true,
        })
      } catch (error) {
        const restoreError =
          error instanceof Error ? error : new Error(`恢复无头浏览器失败：${String(error)}`)
        this.logger.error(
          `[startTask][${this.account.id}] Failed to restore browser session`,
          error,
        )
        return Result.fail(restoreError)
      }
    }

    if (!this.browserSession && !canStartWithoutBrowser) {
      return Result.fail(new Error('浏览器会话未就绪，请重新连接账号后再启动任务'))
    }

    const result = await startAccountSessionTask({
      activeTasks: this.activeTasks,
      task,
      platform: this.platform,
      account: this.account,
      logger: this.logger,
    })
    if (Result.isFailure(result)) {
      this.scheduleOfflineIdleSleep(`start-task-failed:${task.type}`)
    } else {
      this.cancelIdleSleep(`task-started:${task.type}`)
    }
    return result
  }

  public stopTask(taskType: LiveControlTask['type']) {
    stopAccountSessionTask({
      activeTasks: this.activeTasks,
      taskType,
      accountId: this.account.id,
      logger: this.logger,
    })
    this.scheduleOfflineIdleSleep(`task-stopped:${taskType}`)
  }

  public updateTaskConfig<T extends LiveControlTask>(
    type: T['type'],
    config: Partial<T['config']>,
  ): Result.Result<void, Error> {
    return updateAccountSessionTaskConfig(this.activeTasks, type, config)
  }

  public getActiveTaskTypes(): LiveControlTask['type'][] {
    return getActiveAccountSessionTaskTypes(this.activeTasks)
  }

  public setAutoStartOnLiveEnabled(enabled: boolean): void {
    if (this.autoStartOnLiveEnabled === enabled) {
      return
    }

    this.autoStartOnLiveEnabled = enabled
    this.logger.info(`[idle-sleep] 开播自动启动=${enabled ? '开启' : '关闭'}`)
    if (enabled) {
      this.wakeFromIdleSleep('auto-start-enabled')
      this.cancelIdleSleep('auto-start-enabled')
      return
    }
    this.scheduleOfflineIdleSleep('auto-start-disabled')
  }

  public wakeFromIdleSleep(reason: string): void {
    this.cancelIdleSleep(reason)
    if (!this.isIdleSleeping) {
      return
    }

    this.isIdleSleeping = false
    this.logger.info(`[idle-sleep] 唤醒离线休眠检测，reason=${reason}`)
    this.streamStateDetector.keepAlive()
  }

  private handleStreamStateChanged(state: StreamStatus): void {
    if (state === 'offline') {
      this.scheduleOfflineIdleSleep('stream-offline')
      return
    }

    this.cancelIdleSleep(`stream-${state}`)
    this.isIdleSleeping = false
  }

  private shouldEnterOfflineIdleSleep(): boolean {
    return (
      !this.isDisconnected &&
      !this.isDisconnecting &&
      this.streamStateDetector.getCurrentState() === 'offline' &&
      this.getActiveTaskTypes().length === 0 &&
      !this.autoStartOnLiveEnabled
    )
  }

  private scheduleOfflineIdleSleep(reason: string): void {
    if (this.idleSleepTimer || this.isIdleSleeping || !this.shouldEnterOfflineIdleSleep()) {
      return
    }

    this.logger.info(
      `[idle-sleep] 离线且无任务，${Math.round(OFFLINE_IDLE_SLEEP_MS / 1000)} 秒后进入休眠，reason=${reason}`,
    )
    this.idleSleepTimer = setTimeout(() => {
      this.idleSleepTimer = null
      void this.enterOfflineIdleSleep()
    }, OFFLINE_IDLE_SLEEP_MS)
  }

  private cancelIdleSleep(reason: string): void {
    if (!this.idleSleepTimer) {
      return
    }
    clearTimeout(this.idleSleepTimer)
    this.idleSleepTimer = null
    this.logger.info(`[idle-sleep] 取消离线休眠计时，reason=${reason}`)
  }

  private async enterOfflineIdleSleep(): Promise<void> {
    if (!this.shouldEnterOfflineIdleSleep()) {
      this.logger.info('[idle-sleep] 条件已变化，跳过休眠')
      return
    }

    this.isIdleSleeping = true
    this.logger.info('[idle-sleep] 离线且无任务超过 5 分钟，暂停直播状态检测并释放空闲资源')
    this.streamStateDetector.stop()

    if (!this.browserSession) {
      this.streamStateDetector.updateBrowserSession(null)
      return
    }

    if (!this.browserSession.isHeadless) {
      this.logger.info('[idle-sleep] 当前是有头浏览器，仅暂停检测，不自动关闭可见窗口')
      return
    }

    const session = this.browserSession
    this.clearBrowserEventBindings()
    this.browserSession = null
    this.streamStateDetector.updateBrowserSession(null)
    await closeAccountSessionBrowserSession(session, this.logger).catch(error => {
      this.logger.warn('[idle-sleep] 释放无头浏览器资源失败：', error)
    })
  }

  public async fetchAutoPopupGoodsIds(): Result.ResultAsync<number[], Error> {
    return await fetchAccountSessionAutoPopupGoodsIds(this.platform)
  }

  public async sendComment(message: string): Result.ResultAsync<boolean, Error> {
    return await sendAccountSessionComment(this.platform, message)
  }

  public async fetchAutoPopupGoodsMeta(): Result.ResultAsync<
    Array<{ id: number; title?: string }>,
    Error
  > {
    return await fetchAccountSessionAutoPopupGoodsMeta(this.platform)
  }

  public async scanAutoPopupGoodsKnowledge(goodsId: number): Result.ResultAsync<
    {
      id: number
      title?: string
      priceText?: string
      detailText?: string
      source: 'detail-page' | 'list-item'
    },
    Error
  > {
    return await scanAccountSessionAutoPopupGoodsKnowledge(this.platform, goodsId)
  }

  /**
   * 获取当前页面 URL
   * 用于小号互动功能自动获取直播间链接
   */
  public getCurrentUrl(): string | null {
    return getAccountSessionCurrentUrl(this.browserSession, this.logger)
  }

  /**
   * 获取直播间 URL（用于小号互动）
   * 如果主账号在中控台页面，会尝试从中控台提取直播间链接
   */
  public async getLiveRoomUrl(): Promise<{ success: boolean; url?: string; error?: string }> {
    return await getAccountSessionLiveRoomUrl({
      browserSession: this.browserSession,
      logger: this.logger,
    })
  }

  /**
   * 【P0-2 断线自动重连】执行重连
   *
   * @param reason 重连原因
   * @returns 是否重连成功
   */
  async reconnect(reason: ReconnectReason): Promise<boolean> {
    return await reconnectAccountSession({
      accountId: this.account.id,
      reason,
      logger: this.logger,
      emitConnectionState: connectState => this.emitConnectionState(connectState),
      prepareForReconnect: async () => {
        await this.runStopTasksAndUpdateState(reason, {
          closeBrowser: false,
          sendDisconnectEvent: false,
          stopDetector: true,
        })
      },
      resetConnectionFlags: () => {
        this.isDisconnecting = false
        this.isDisconnected = false
      },
      connect: () =>
        this.connect({
          headless: true,
          suppressTerminalStateOnFailure: true,
        }),
    })
  }

  /**
   * 【P0-2 场景D】检测登录态是否失效
   * 通过检测URL是否跳转到登录页来判断
   *
   * @param url 当前页面URL
   * @returns 是否已失效（跳转到登录页）
   */
  private isAuthExpired(url: string): boolean {
    return isAccountSessionAuthExpired(this.platformId, url, this.logger)
  }
}
