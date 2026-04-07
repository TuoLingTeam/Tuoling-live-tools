import { Result } from '@praha/byethrow'
import type { Browser, BrowserContext, Page } from 'playwright'
import { normalizeSubAccountLiveRoomUrl } from 'shared/subAccountLiveRoom'
import { createLogger } from '#/logger'
import type { StorageState } from '#/managers/BrowserSessionManager'
import type { IPerformComment, IPlatform } from '#/platforms/IPlatform'
import { SUB_ACCOUNT_PLATFORM_CONFIGS } from '#/platforms/sub-account/SimpleCommentPlatform'
import {
  clearSubAccountStorageState,
  loadSubAccountStorageState,
  saveSubAccountStorageState,
} from '#/services/SubAccountSessionStorage'
import { sendSubAccountComment, withSubAccountSendLock } from './subAccountCommentFlow'
import {
  cleanupSubAccountManager,
  cleanupSubAccountSession,
  performSubAccountHealthCheck,
} from './subAccountLifecycle'
import {
  resolveSubAccountInitialLogin,
  startSubAccountLoginPolling,
  stopSubAccountLoginPolling,
} from './subAccountLoginFlow'
import { enterSubAccountLiveRoom } from './subAccountRoomFlow'

const logger = createLogger('SubAccountManager')
// 版本标记：支持二次验证的登录流程 v2.1 - 添加轮询检测

export class SubAccountVerificationRequiredError extends Error {
  readonly requiresVerification = true

  constructor(message = '检测到平台安全验证，请先在浏览器完成滑块或验证码，再重新启动任务') {
    super(message)
    this.name = 'SubAccountVerificationRequiredError'
  }
}

export type SubAccountStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface SubAccountStats {
  totalSent: number
  successCount: number
  failCount: number
  lastSendTime?: number
  lastError?: string
}

export interface SubAccountSession {
  id: string
  name: string
  platform: LiveControlPlatform
  status: SubAccountStatus
  browser?: Browser
  context?: BrowserContext
  page?: Page
  platformInstance?: IPlatform & IPerformComment
  error?: string
  stats: SubAccountStats
  storageState?: string
  liveRoomUrl?: string
  liveRoomStatus: 'idle' | 'entering' | 'entered' | 'error'
  lastEnterError?: string
}

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
]

let browserSessionManagerPromise: Promise<
  typeof import('#/managers/BrowserSessionManager')
> | null = null

async function getBrowserManager() {
  if (!browserSessionManagerPromise) {
    browserSessionManagerPromise = import('#/managers/BrowserSessionManager')
  }
  return (await browserSessionManagerPromise).browserManager
}

class SubAccountManager {
  private sessions: Map<string, SubAccountSession> = new Map()
  private healthCheckInterval?: ReturnType<typeof setInterval>
  private readonly HEALTH_CHECK_INTERVAL = 30 * 1000
  /** 每小号发送锁，避免定时任务与一键刷屏并发操作同一页面 */
  private sendLocks: Map<string, Promise<void>> = new Map()
  /** 状态变更回调 */
  private onStatusChangeCallbacks: Array<
    (accountId: string, status: SubAccountStatus, error?: string) => void
  > = []
  /** 会话运行态变更回调，用于同步进房等非连接状态 */
  private onSessionUpdateCallbacks: Array<(accountId: string) => void> = []
  /** 登录轮询定时器追踪，防止内存泄露 */
  private loginPollTimers: Map<string, NodeJS.Timeout> = new Map()
  /** 标记是否已清理，防止重复清理 */
  private isCleanedUp = false

  constructor() {
    this.startHealthCheck()

    // 监听进程退出信号，确保清理资源
    process.on('exit', () => {
      this.cleanup()
    })

    // 处理 SIGINT (Ctrl+C) 和 SIGTERM
    process.on('SIGINT', () => {
      console.log('[SubAccountManager] 收到 SIGINT，开始清理...')
      this.cleanup().then(() => {
        process.exit(0)
      })
    })

    process.on('SIGTERM', () => {
      console.log('[SubAccountManager] 收到 SIGTERM，开始清理...')
      this.cleanup().then(() => {
        process.exit(0)
      })
    })
  }

  /**
   * 注册状态变更回调
   */
  onStatusChange(
    callback: (accountId: string, status: SubAccountStatus, error?: string) => void,
  ): void {
    this.onStatusChangeCallbacks.push(callback)
  }

  onSessionUpdate(callback: (accountId: string) => void): void {
    this.onSessionUpdateCallbacks.push(callback)
  }

  /**
   * 通知状态变更
   */
  private notifyStatusChange(accountId: string, status: SubAccountStatus, error?: string): void {
    for (const callback of this.onStatusChangeCallbacks) {
      try {
        callback(accountId, status, error)
      } catch (e) {
        logger.error('状态变更回调执行失败:', e)
      }
    }
  }

  private notifySessionUpdate(accountId: string): void {
    for (const callback of this.onSessionUpdateCallbacks) {
      try {
        callback(accountId)
      } catch (e) {
        logger.error('会话状态变更回调执行失败:', e)
      }
    }
  }

  private isLikelyLiveRoomPage(currentUrl?: string): boolean {
    if (!currentUrl) return false
    return currentUrl.includes('live.douyin.com') || currentUrl.includes('live.kuaishou.com')
  }

  private setLiveRoomState(
    session: SubAccountSession,
    state: SubAccountSession['liveRoomStatus'],
    options?: { url?: string; error?: string },
  ) {
    session.liveRoomStatus = state
    session.lastEnterError = options?.error
    session.liveRoomUrl =
      state === 'entered'
        ? (normalizeSubAccountLiveRoomUrl(
            options?.url ?? session.page?.url() ?? session.liveRoomUrl,
          ) ??
          options?.url ??
          session.liveRoomUrl)
        : options?.url
    this.notifySessionUpdate(session.id)
  }

  private startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck()
    }, this.HEALTH_CHECK_INTERVAL)
  }

  private async performHealthCheck() {
    await performSubAccountHealthCheck({
      sessions: this.sessions.values(),
      logger,
      cleanupSession: session => this.cleanupSession(session),
      notifyStatusChange: (accountId, status, error) =>
        this.notifyStatusChange(accountId, status, error),
    })
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  addAccount(config: SubAccountConfig): Result.Result<SubAccountSession, Error> {
    if (this.sessions.has(config.id)) {
      return Result.fail(new Error(`小号 ${config.name} 已存在`))
    }

    const session: SubAccountSession = {
      id: config.id,
      name: config.name,
      platform: config.platform,
      status: 'idle',
      stats: {
        totalSent: 0,
        successCount: 0,
        failCount: 0,
      },
      liveRoomStatus: 'idle',
    }

    const persistedStorageState = loadSubAccountStorageState(config.id, config.platform)
    if (persistedStorageState) {
      session.storageState = persistedStorageState
    }

    this.sessions.set(config.id, session)
    logger.info(`添加小号: ${config.name} (${config.platform})`)
    return Result.succeed(session)
  }

  async removeAccount(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return

    // 先停止登录轮询
    this.stopLoginPolling(accountId)

    await this.cleanupSession(session)
    clearSubAccountStorageState(accountId)
    session.status = 'idle'
    session.error = undefined
    this.notifyStatusChange(session.id, 'idle')
    this.sessions.delete(accountId)
    logger.info(`移除小号：${session.name}`)
  }

  clearStorageState(accountId: string): boolean {
    const session = this.sessions.get(accountId)
    if (!session) {
      return false
    }

    session.storageState = undefined
    clearSubAccountStorageState(accountId)
    return true
  }

  private persistStorageState(
    session: SubAccountSession,
    storageState: StorageState | string,
  ): void {
    const serialized =
      typeof storageState === 'string' ? storageState : JSON.stringify(storageState)
    session.storageState = serialized
    saveSubAccountStorageState(session.id, serialized, session.platform)
  }

  private getPlatformConfig(platform: LiveControlPlatform) {
    return SUB_ACCOUNT_PLATFORM_CONFIGS[platform] ?? SUB_ACCOUNT_PLATFORM_CONFIGS.douyin
  }

  private getPlatformHomeUrl(platform: LiveControlPlatform): string {
    return this.getPlatformConfig(platform).loginUrl
  }

  private getLoggedInSelector(platform: LiveControlPlatform): string {
    return this.getPlatformConfig(platform).loggedInSelector
  }

  async connectAccount(
    accountId: string,
    headless = true,
    _timeoutMs = 5 * 60 * 1000,
  ): Promise<Result.Result<SubAccountSession, Error>> {
    const session = this.sessions.get(accountId)
    if (!session) {
      return Result.fail(new Error('小号不存在'))
    }

    if (session.status === 'connected') {
      return Result.succeed(session)
    }

    if (session.status === 'connecting') {
      // 通过检查浏览器实例是否仍存活来判断是否真的在连接中
      const hasActiveBrowser = session.browser?.isConnected?.() ?? false
      if (!hasActiveBrowser) {
        logger.warn(`小号 ${session.name} 连接状态异常，重置为空闲状态`)
        session.status = 'idle'
        session.error = undefined
        this.notifyStatusChange(session.id, 'idle')
        await this.cleanupSession(session)
      } else {
        return Result.fail(new Error('小号正在连接中，请稍候'))
      }
    }

    session.status = 'connecting'
    session.error = undefined
    session.liveRoomUrl = undefined
    session.liveRoomStatus = 'idle'
    session.lastEnterError = undefined
    this.notifyStatusChange(session.id, 'connecting')

    try {
      let storageState: StorageState | undefined
      if (session.storageState) {
        try {
          storageState = JSON.parse(session.storageState)
          logger.info(`小号 ${session.name} 使用保存的登录状态`)
        } catch {
          logger.warn(`小号 ${session.name} 登录状态解析失败，将重新登录`)
          session.storageState = undefined
          clearSubAccountStorageState(session.id)
        }
      }

      const browserSession = await (await getBrowserManager()).createSession(headless, storageState)
      const { browser, context, page } = browserSession

      const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]
      await page.setViewportSize(viewport)

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false })
      })

      session.browser = browser
      session.context = context
      session.page = page

      const homeUrl = this.getPlatformHomeUrl(session.platform)
      const loggedInSelector = this.getLoggedInSelector(session.platform)

      logger.info(`小号 ${session.name} 正在登录 ${session.platform} 主站...`)

      // 使用更长的超时时间，并允许页面加载不完全（load 而非 networkidle）
      // 这样可以更快进入页面，让用户看到登录界面
      try {
        await page.goto(homeUrl, { waitUntil: 'load', timeout: 30000 })
      } catch (_gotoError) {
        // 页面加载超时，但可能页面已经可用，继续尝试
        logger.warn(`小号 ${session.name} 页面加载超时，继续检查登录状态`)
      }

      // 等待页面稳定（网络空闲）
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 })
      } catch {
        // 忽略网络空闲超时
      }

      const loginResolution = await resolveSubAccountInitialLogin({
        page,
        loggedInSelector,
        sessionName: session.name,
        logger,
      })

      if (loginResolution.state === 'waiting_verification') {
        session.status = 'connecting'
        session.error = loginResolution.message
        this.notifyStatusChange(session.id, 'connecting', loginResolution.message)
        this.startLoginPolling(session, loggedInSelector)
        return Result.succeed(session)
      }

      session.status = 'connected'
      this.notifyStatusChange(session.id, 'connected')

      try {
        const newStorageState = await context.storageState()
        this.persistStorageState(session, newStorageState)
        logger.info(`小号 ${session.name} 登录状态已保存`)
      } catch (error) {
        logger.warn(`小号 ${session.name} 保存登录状态失败:`, error)
      }

      logger.success(`小号连接成功: ${session.name}（观众身份）`)
      return Result.succeed(session)
    } catch (error) {
      // 只有在不是二次验证的情况下才清理会话
      if (session.status !== 'connecting') {
        await this.cleanupSession(session)
        session.status = 'error'
        this.notifyStatusChange(
          session.id,
          'error',
          error instanceof Error ? error.message : '登录超时或失败',
        )
      }
      session.error = error instanceof Error ? error.message : '登录超时或失败'
      logger.error(`小号连接失败: ${session.name}`, error)
      return Result.fail(error instanceof Error ? error : new Error('连接失败'))
    }
  }

  private async cleanupSession(session: SubAccountSession): Promise<void> {
    await cleanupSubAccountSession({
      session,
      logger,
      stopLoginPolling: accountId => this.stopLoginPolling(accountId),
    })
  }

  /**
   * 停止登录轮询检测
   */
  private stopLoginPolling(accountId: string): void {
    stopSubAccountLoginPolling({
      accountId,
      loginPollTimers: this.loginPollTimers,
      logger,
    })
  }

  /**
   * 启动登录状态轮询检测
   * 当用户需要二次验证时，后台轮询检测用户何时完成登录
   */
  private startLoginPolling(session: SubAccountSession, loggedInSelector: string): void {
    startSubAccountLoginPolling({
      session,
      loggedInSelector,
      loginPollTimers: this.loginPollTimers,
      logger,
      notifyStatusChange: (accountId, status, error) =>
        this.notifyStatusChange(accountId, status, error),
      persistStorageState: (currentSession, storageState) =>
        this.persistStorageState(currentSession, storageState),
      cleanupSession: currentSession => this.cleanupSession(currentSession),
    })
  }

  async disconnectAccount(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId)
    if (!session) return

    await this.cleanupSession(session)
    session.status = 'idle'
    session.error = undefined
    session.liveRoomUrl = undefined
    session.liveRoomStatus = 'idle'
    session.lastEnterError = undefined
    this.notifyStatusChange(session.id, 'idle')
  }

  getAllAccounts(): SubAccountSession[] {
    return Array.from(this.sessions.values())
  }

  getConnectedAccounts(): SubAccountSession[] {
    return this.getAllAccounts().filter(s => s.status === 'connected')
  }

  getAccount(accountId: string): SubAccountSession | undefined {
    return this.sessions.get(accountId)
  }

  private getLiveRoomSelectors(platform: LiveControlPlatform): {
    inputSelector: string
    sendButtonSelector: string
    sendMethod: 'click' | 'enter'
  } {
    const cfg = this.getPlatformConfig(platform)
    return {
      inputSelector: cfg.commentInputSelector,
      sendButtonSelector: cfg.sendButtonSelector,
      sendMethod: cfg.sendMethod ?? 'click',
    }
  }

  async enterLiveRoom(
    accountId: string,
    liveRoomUrl: string,
  ): Promise<Result.Result<boolean, Error>> {
    const session = this.sessions.get(accountId)
    if (!session) {
      return Result.fail(new Error('小号不存在'))
    }

    return await enterSubAccountLiveRoom({
      session,
      liveRoomUrl,
      logger,
      loggedInSelector: this.getLoggedInSelector(session.platform),
      getLiveRoomSelectors: platform => this.getLiveRoomSelectors(platform),
      isLikelyLiveRoomPage: currentUrl => this.isLikelyLiveRoomPage(currentUrl),
      notifyStatusChange: (nextAccountId, status, error) =>
        this.notifyStatusChange(nextAccountId, status, error),
      notifySessionUpdate: nextAccountId => this.notifySessionUpdate(nextAccountId),
      setLiveRoomState: (currentSession, state, options) =>
        this.setLiveRoomState(currentSession, state, options),
    })
  }

  async sendComment(accountId: string, message: string): Promise<Result.Result<boolean, Error>> {
    const session = this.sessions.get(accountId)
    if (!session) {
      return Result.fail(new Error('小号不存在'))
    }

    if (session.status !== 'connected' || !session.page) {
      return Result.fail(new Error('小号未连接'))
    }

    if (!session.liveRoomUrl) {
      return Result.fail(new Error('小号尚未进入直播间，请先设置直播间地址'))
    }

    return await withSubAccountSendLock({
      accountId,
      sendLocks: this.sendLocks,
      logger,
      task: async () => {
        try {
          return await sendSubAccountComment({
            session,
            message,
            logger,
            getLiveRoomSelectors: platform => this.getLiveRoomSelectors(platform),
            createVerificationError: errorMessage =>
              new SubAccountVerificationRequiredError(errorMessage),
          })
        } catch (error) {
          logger.error(`小号 ${session.name} 发送评论时发生未捕获异常:`, error)
          return Result.fail(error instanceof Error ? error : new Error('发送失败'))
        }
      },
    })
  }

  getAccountStats(accountId: string): SubAccountStats | undefined {
    const session = this.sessions.get(accountId)
    return session?.stats
  }

  async checkHealth(
    accountId: string,
  ): Promise<{ status: 'healthy' | 'warning' | 'error'; message?: string }> {
    const session = this.sessions.get(accountId)
    if (!session) {
      return { status: 'error', message: '小号不存在' }
    }

    if (session.status !== 'connected') {
      return { status: 'error', message: '小号未连接' }
    }

    const stats = session.stats
    if (stats.totalSent >= 5) {
      const errorRate = stats.failCount / stats.totalSent
      if (errorRate >= 0.8) {
        return {
          status: 'error',
          message: `错误率过高 (${(errorRate * 100).toFixed(0)}%)，可能已被封禁`,
        }
      }
      if (errorRate >= 0.5) {
        return {
          status: 'warning',
          message: `错误率较高 (${(errorRate * 100).toFixed(0)}%)，建议检查`,
        }
      }
    }

    if (stats.lastError && stats.lastSendTime) {
      const timeSinceLastError = Date.now() - stats.lastSendTime
      const fiveMinutes = 5 * 60 * 1000
      if (timeSinceLastError < fiveMinutes && stats.failCount > stats.successCount) {
        return { status: 'warning', message: '最近发送失败较多' }
      }
    }

    return { status: 'healthy' }
  }

  async cleanup(): Promise<void> {
    await cleanupSubAccountManager({
      isCleanedUp: this.isCleanedUp,
      markCleanedUp: () => {
        this.isCleanedUp = true
      },
      logger,
      stopHealthCheck: () => this.stopHealthCheck(),
      loginPollTimers: this.loginPollTimers,
      sessions: this.sessions,
      sendLocks: this.sendLocks,
      cleanupSession: session => this.cleanupSession(session),
      notifyStatusChange: (accountId, status, error) =>
        this.notifyStatusChange(accountId, status, error),
    })
  }
}

export const subAccountManager = new SubAccountManager()
