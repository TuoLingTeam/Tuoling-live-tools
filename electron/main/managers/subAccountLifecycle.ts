import type { Browser, BrowserContext, Page } from 'playwright'
import type { createLogger } from '#/logger'
import { browserManager } from '#/managers/BrowserSessionManager'
import type { IPerformComment, IPlatform } from '#/platforms/IPlatform'

type SessionLogger = ReturnType<typeof createLogger>

type LifecycleSession = {
  id: string
  name: string
  status: 'idle' | 'connecting' | 'connected' | 'error'
  browser?: Browser
  context?: BrowserContext
  page?: Page
  browserOwnership?: 'exclusive' | 'shared' | 'persistent'
  platformInstance?: IPlatform & IPerformComment
  error?: string
  liveRoomStatus: 'idle' | 'entering' | 'entered' | 'error'
  lastEnterError?: string
}

export async function cleanupSubAccountSession<TSession extends LifecycleSession>(params: {
  session: TSession
  logger: SessionLogger
  stopLoginPolling: (accountId: string) => void
}) {
  const { session, logger, stopLoginPolling } = params

  try {
    await session.platformInstance?.disconnect()
  } catch (error) {
    logger.error(`清理平台实例失败：${session.name}`, error)
  }

  try {
    await session.page?.close()
  } catch (error) {
    logger.error(`关闭页面失败：${session.name}`, error)
  }

  try {
    await session.context?.close()
  } catch (error) {
    logger.error(`关闭浏览器上下文失败：${session.name}`, error)
  }

  try {
    if (session.browser && session.context && session.page) {
      await browserManager.releaseSessionBrowser({
        browser: session.browser,
        context: session.context,
        page: session.page,
        browserOwnership: session.browserOwnership ?? 'exclusive',
        isHeadless: session.browserOwnership === 'shared',
      })
    } else if (session.browser && session.browserOwnership !== 'shared') {
      await session.browser.close()
    }
  } catch (error) {
    logger.error(`关闭浏览器实例失败：${session.name}`, error)
  }

  session.browser = undefined
  session.context = undefined
  session.page = undefined
  session.browserOwnership = undefined
  session.platformInstance = undefined

  stopLoginPolling(session.id)
}

export async function performSubAccountHealthCheck<TSession extends LifecycleSession>(params: {
  sessions: Iterable<TSession>
  logger: SessionLogger
  cleanupSession: (session: TSession) => Promise<void>
  notifyStatusChange: (accountId: string, status: TSession['status'], error?: string) => void
}) {
  const { sessions, logger, cleanupSession, notifyStatusChange } = params

  for (const session of sessions) {
    if (session.status !== 'connected') continue

    try {
      if (!session.page) continue

      if (session.page.isClosed()) {
        logger.warn(`小号 ${session.name} 页面已关闭，标记为断开`)
        await cleanupSession(session)
        session.status = 'error'
        session.error = '页面已关闭'
        session.liveRoomStatus = 'error'
        session.lastEnterError = '页面已关闭'
        notifyStatusChange(session.id, 'error', '页面已关闭')
        continue
      }

      await session.page.title()
    } catch (error) {
      logger.error(`小号 ${session.name} 健康检查失败:`, error)
      session.status = 'error'
      session.error = '连接异常，请重新登录'
      session.liveRoomStatus = 'error'
      session.lastEnterError = '连接异常，请重新登录'
      notifyStatusChange(session.id, 'error', '连接异常，请重新登录')
      await cleanupSession(session)
    }
  }
}

export async function cleanupSubAccountManager<TSession extends LifecycleSession>(params: {
  isCleanedUp: boolean
  markCleanedUp: () => void
  logger: SessionLogger
  stopHealthCheck: () => void
  loginPollTimers: Map<string, NodeJS.Timeout>
  sessions: Map<string, TSession>
  sendLocks: Map<string, Promise<void>>
  cleanupSession: (session: TSession) => Promise<void>
  notifyStatusChange: (accountId: string, status: TSession['status'], error?: string) => void
}) {
  const {
    isCleanedUp,
    markCleanedUp,
    logger,
    stopHealthCheck,
    loginPollTimers,
    sessions,
    sendLocks,
    cleanupSession,
    notifyStatusChange,
  } = params

  if (isCleanedUp) {
    logger.info('SubAccountManager 已经清理，跳过')
    return
  }

  markCleanedUp()
  logger.info('SubAccountManager 开始清理...')
  stopHealthCheck()

  for (const [accountId, timer] of loginPollTimers.entries()) {
    clearTimeout(timer)
    logger.info(`清理登录轮询定时器: ${accountId}`)
  }
  loginPollTimers.clear()

  const cleanupPromises = Array.from(sessions.values()).map(async session => {
    await cleanupSession(session)
    session.status = 'idle'
    session.error = undefined
    notifyStatusChange(session.id, 'idle')
  })
  await Promise.all(cleanupPromises)

  sessions.clear()
  sendLocks.clear()
  logger.info('SubAccountManager 已清理完成')
}
