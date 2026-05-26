import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  type BrowserSession,
  browserManager,
  type StorageState,
} from '#/managers/BrowserSessionManager'
import type { IPlatform } from '#/platforms/IPlatform'
import { type ReconnectReason, reconnectManager } from '#/services/ReconnectManager'
import type { StreamStateDetector } from '#/services/StreamStateDetector'
import windowManager from '#/windowManager'
import { isBenignCloseError } from './accountSessionBrowser'
import type {
  ConnectionTimeouts,
  EmitConnectionState,
  SessionLogger,
  WithTimeout,
} from './accountSessionShared'
import { bindAccountSessionBrowserEvents, notifyAccountSessionName } from './accountSessionSignals'

export interface FinalizeAccountSessionConnectionResult {
  unbindBrowserEvents: () => void
  accountName: string | null
}

export function parseAccountSessionStorageState(
  storageState: string | undefined,
  logger: SessionLogger,
): StorageState | undefined {
  if (!storageState) {
    return undefined
  }

  logger.info('检测到已保存登录状态')
  return JSON.parse(storageState)
}

export async function closeAccountSessionBrowserSession(
  session: BrowserSession,
  logger: SessionLogger,
) {
  try {
    if (!session.page.isClosed()) {
      await session.page.close().catch(error => {
        if (!isBenignCloseError(error)) {
          throw error
        }
      })
    }
  } catch (error) {
    logger.warn('[ensureAuthenticated] 关闭临时页面失败，将继续尝试关闭上下文/浏览器：', error)
  }

  await session.context.close().catch(error => {
    if (!isBenignCloseError(error)) {
      throw error
    }
  })
  await browserManager.releaseSessionBrowser(session)
}

export async function launchAccountSessionBrowserSession(params: {
  accountId: string
  platformId: LiveControlPlatform
  headless: boolean
  storageState?: StorageState
  logger: SessionLogger
  emitConnectionState: EmitConnectionState
  withTimeout: WithTimeout
  timeouts: Pick<ConnectionTimeouts, 'browserLaunchMs'>
}): Promise<BrowserSession> {
  const {
    accountId,
    platformId,
    headless,
    storageState,
    logger,
    emitConnectionState,
    withTimeout,
    timeouts,
  } = params

  logger.info(`[连接] 使用headless模式: ${headless}`)
  emitConnectionState({
    status: 'connecting',
    phase: 'launching_browser',
    error: null,
  })

  const usePersistentUserSession = !headless && ['buyin', 'douyin'].includes(platformId)
  if (usePersistentUserSession) {
    if (storageState) {
      logger.info('[连接] 可见浏览器将使用账号隔离 profile，已保存登录态会在连接成功后重新同步')
    }
    return await withTimeout(
      browserManager.createPersistentUserSession({
        platform: platformId,
        accountId,
      }),
      timeouts.browserLaunchMs,
      '启动浏览器超时，请重试',
    )
  }

  return await withTimeout(
    browserManager.createSession(headless, storageState),
    timeouts.browserLaunchMs,
    '启动浏览器超时，请重试',
  )
}

export async function ensureAccountSessionAuthenticated(params: {
  accountId: string
  platformId: LiveControlPlatform
  session: BrowserSession
  headless: boolean
  platform: IPlatform
  logger: SessionLogger
  streamStateDetector: StreamStateDetector
  emitConnectionState: EmitConnectionState
  withTimeout: WithTimeout
  setBrowserSession: (session: BrowserSession) => void
  setWaitingForLogin: (waiting: boolean) => void
  timeouts: ConnectionTimeouts
}): Promise<{ browserSession: BrowserSession; needsLogin: boolean }> {
  const {
    accountId,
    platformId,
    session,
    headless,
    platform,
    logger,
    streamStateDetector,
    emitConnectionState,
    withTimeout,
    setBrowserSession,
    setWaitingForLogin,
    timeouts,
  } = params

  let currentSession = session
  setBrowserSession(currentSession)
  streamStateDetector.updateBrowserSession(currentSession)

  emitConnectionState({
    status: 'connecting',
    phase: 'verifying_session',
    error: null,
  })

  const isConnected = await withTimeout(
    platform.connect(currentSession),
    timeouts.sessionVerifyMs,
    '连接校验超时，请重试',
  )

  if (isConnected) {
    return { browserSession: currentSession, needsLogin: false }
  }

  setWaitingForLogin(true)
  logger.info('[ensureAuthenticated] 设置 isWaitingForLogin = true')

  if (headless) {
    await closeAccountSessionBrowserSession(currentSession, logger)
    logger.info('需要登录，请在打开的浏览器中登录')
    emitConnectionState({
      status: 'connecting',
      phase: 'launching_browser',
      error: null,
    })
    currentSession = await withTimeout(
      ['buyin', 'douyin'].includes(platformId)
        ? browserManager.createPersistentUserSession({
            platform: platformId,
            accountId,
          })
        : browserManager.createSession(false),
      timeouts.browserLaunchMs,
      '启动登录浏览器超时，请重试',
    )
    setBrowserSession(currentSession)
  }

  emitConnectionState({
    status: 'connecting',
    phase: 'waiting_for_login',
    error: null,
  })

  await withTimeout(
    platform.login(currentSession),
    timeouts.loginMs,
    '登录超时，请检查是否已完成扫码登录',
  )

  setWaitingForLogin(false)
  logger.info('[ensureAuthenticated] 设置 isWaitingForLogin = false（登录成功）')

  streamStateDetector.updateBrowserSession(currentSession)
  const storageState: StorageState = await currentSession.context.storageState()

  if (headless) {
    await closeAccountSessionBrowserSession(currentSession, logger)
    logger.info('登录成功，浏览器将继续以无头模式运行')
    emitConnectionState({
      status: 'connecting',
      phase: 'launching_browser',
      error: null,
    })
    currentSession = await withTimeout(
      browserManager.createSession(true, storageState),
      timeouts.browserLaunchMs,
      '恢复无头浏览器超时，请重试',
    )
    setBrowserSession(currentSession)
    streamStateDetector.updateBrowserSession(currentSession)
  }

  return await ensureAccountSessionAuthenticated({
    ...params,
    session: currentSession,
  })
}

export async function reconnectAccountSession(params: {
  accountId: string
  reason: ReconnectReason
  logger: SessionLogger
  emitConnectionState: EmitConnectionState
  prepareForReconnect: () => Promise<void>
  resetConnectionFlags: () => void
  connect: () => Promise<{ needsLogin: boolean; accountName?: string | null }>
}) {
  const {
    accountId,
    reason,
    logger,
    emitConnectionState,
    prepareForReconnect,
    resetConnectionFlags,
    connect,
  } = params

  logger.info(`[reconnect][${accountId}] START, reason=${reason}`)

  if (!reconnectManager.shouldReconnect(reason)) {
    logger.info(`[reconnect][${accountId}] 不允许重连: ${reason}`)
    return false
  }

  await prepareForReconnect()
  emitConnectionState({
    status: 'reconnecting',
    phase: 'recovering',
    error: null,
    session: null,
    lastVerifiedAt: null,
  })

  const result = await reconnectManager.attemptReconnect(accountId, reason, async () => {
    try {
      logger.info(`[reconnect][${accountId}] 尝试重新连接...`)
      resetConnectionFlags()

      const { needsLogin } = await connect()

      if (needsLogin) {
        logger.warn(`[reconnect][${accountId}] 需要重新登录，重连失败`)
        return false
      }

      logger.success(`[reconnect][${accountId}] 重连成功`)
      windowManager.send(IPC_CHANNELS.tasks.liveControl.reconnectedEvent, accountId, {
        success: true,
      })
      return true
    } catch (error) {
      logger.error(`[reconnect][${accountId}] 重连失败:`, error)
      return false
    }
  })

  logger.info(`[reconnect][${accountId}] END, result=${result}`)

  if (result === 'failed') {
    windowManager.send(IPC_CHANNELS.tasks.liveControl.reconnectFailedEvent, accountId, {
      reason,
      message: '自动重连失败，请手动重新连接',
    })
  }

  return result === 'success'
}

export async function finalizeAccountSessionConnection(params: {
  browserSession: BrowserSession
  accountId: string
  platformId: LiveControlPlatform
  platform: IPlatform
  fallbackAccountName: string
  logger: SessionLogger
  streamStateDetector: StreamStateDetector
  isDisconnecting: () => boolean
  isDisconnected: () => boolean
  isAuthExpired: (url: string) => boolean
  emitConnectionState: EmitConnectionState
  verifyConnectionHealth: () => Promise<{ healthy: boolean; reason?: string }>
  onPageClosed: (reason: ReconnectReason) => void
}): Promise<FinalizeAccountSessionConnectionResult> {
  const {
    browserSession,
    accountId,
    platformId,
    platform,
    fallbackAccountName,
    logger,
    streamStateDetector,
    isDisconnecting,
    isDisconnected,
    isAuthExpired,
    emitConnectionState,
    verifyConnectionHealth,
    onPageClosed,
  } = params

  const state = JSON.stringify(await browserSession.context.storageState())
  windowManager.send(IPC_CHANNELS.chrome.saveState, accountId, state)

  const accountName = await notifyAccountSessionName({
    platform,
    platformId,
    browserSession,
    accountId,
    fallbackAccountName,
    logger,
  })

  streamStateDetector.start()

  const unbindBrowserEvents = bindAccountSessionBrowserEvents({
    browserSession,
    accountId,
    logger,
    isDisconnecting,
    isDisconnected,
    isAuthExpired,
    onPageClosed,
  })

  emitConnectionState({
    status: 'connecting',
    phase: 'verifying_session',
    error: null,
  })
  logger.info('[健康检查] 验证直播状态检测功能...')
  const healthCheck = await verifyConnectionHealth()
  if (!healthCheck.healthy) {
    logger.error(`[健康检查] 失败: ${healthCheck.reason}`)
    throw new Error(`连接健康检查失败: ${healthCheck.reason}`)
  }

  logger.success('[健康检查] 通过，直播状态检测功能正常')
  emitConnectionState({
    status: 'connected',
    phase: 'streaming',
    error: null,
    lastVerifiedAt: Date.now(),
  })
  logger.success('成功与中控台建立连接')

  return {
    unbindBrowserEvents,
    accountName,
  }
}
