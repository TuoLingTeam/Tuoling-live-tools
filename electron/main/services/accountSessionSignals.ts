import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import type { IPlatform } from '#/platforms/IPlatform'
import type { ReconnectReason } from '#/services/ReconnectManager'
import windowManager from '#/windowManager'
import { detectCloseReason } from './accountSessionBrowser'

type SessionLogger = ReturnType<typeof createLogger>

export async function notifyAccountSessionName(params: {
  platform: IPlatform
  browserSession: BrowserSession
  accountId: string
  fallbackAccountName: string
  logger: SessionLogger
}) {
  const { platform, browserSession, accountId, fallbackAccountName, logger } = params

  try {
    const accountName = await platform.getAccountName(browserSession)
    logger.info(`成功获取用户名：${accountName}`)
    windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
      ok: true,
      accountId,
      accountName,
    })
  } catch (error) {
    logger.error('获取用户名失败:', error)
    windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
      ok: true,
      accountId,
      accountName: fallbackAccountName,
    })
  }
}

export function bindAccountSessionBrowserEvents(params: {
  browserSession: BrowserSession
  accountId: string
  logger: SessionLogger
  isDisconnecting: () => boolean
  isDisconnected: () => boolean
  isAuthExpired: (url: string) => boolean
  onPageClosed: (reason: ReconnectReason) => void
}) {
  const {
    browserSession,
    accountId,
    logger,
    isDisconnecting,
    isDisconnected,
    isAuthExpired,
    onPageClosed,
  } = params

  browserSession.page.on('framenavigated', async frame => {
    if (!frame.parentFrame()) {
      const url = frame.url()
      if (isAuthExpired(url)) {
        logger.warn(`[auth-check] 检测到登录页跳转，登录态失效，URL: ${url}`)
        onPageClosed('auth_expired')
      }
    }
  })

  browserSession.page.on('close', () => {
    if (isDisconnecting() || isDisconnected()) {
      logger.info(`[page-close] 账号 ${accountId} 已经在断开中或已断开，忽略重复事件`)
      return
    }
    if (browserSession.page) {
      logger.info(`[page-close] 账号 ${accountId} 页面关闭`)
      onPageClosed(detectCloseReason('page'))
    }
  })

  browserSession.browser.on('disconnected', () => {
    if (isDisconnecting() || isDisconnected()) {
      logger.info(`[browser-disconnected] 账号 ${accountId} 已经在断开中或已断开，忽略重复事件`)
      return
    }
    logger.warn(`[browser-disconnected] 账号 ${accountId} 浏览器进程已断开`)
    onPageClosed('page_crash')
  })
}
