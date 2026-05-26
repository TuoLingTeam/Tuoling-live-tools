import type { Frame } from 'playwright'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import type { IPlatform } from '#/platforms/IPlatform'
import type { ReconnectReason } from '#/services/ReconnectManager'
import windowManager from '#/windowManager'
import { detectCloseReason } from './accountSessionBrowser'

type SessionLogger = ReturnType<typeof createLogger>
const BROWSER_DISCONNECT_GRACE_MS = 150

export async function notifyAccountSessionName(params: {
  platform: IPlatform
  platformId: LiveControlPlatform
  browserSession: BrowserSession
  accountId: string
  fallbackAccountName: string
  logger: SessionLogger
}): Promise<string | null> {
  const { platform, platformId, browserSession, accountId, fallbackAccountName, logger } = params

  try {
    const accountName = await platform.getAccountName(browserSession)
    logger.info(`成功获取用户名：${accountName}`)
    windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
      ok: true,
      accountId,
      accountName,
      platform: platformId,
    })
    return accountName
  } catch (error) {
    logger.error('获取用户名失败:', error)
    windowManager.send(IPC_CHANNELS.tasks.liveControl.notifyAccountName, {
      ok: false,
      accountId,
      error: `无法识别平台账号名称：${fallbackAccountName}`,
      platform: platformId,
    })
    return null
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
}): () => void {
  const {
    browserSession,
    accountId,
    logger,
    isDisconnecting,
    isDisconnected,
    isAuthExpired,
    onPageClosed,
  } = params
  let closeHandled = false
  let browserDisconnectTimer: ReturnType<typeof setTimeout> | null = null

  const dispatchClose = (reason: ReconnectReason) => {
    if (closeHandled) {
      return
    }
    closeHandled = true
    if (browserDisconnectTimer) {
      clearTimeout(browserDisconnectTimer)
      browserDisconnectTimer = null
    }
    onPageClosed(reason)
  }

  const handleFrameNavigated = async (frame: Frame) => {
    if (!frame.parentFrame()) {
      const url = frame.url()
      if (isAuthExpired(url)) {
        logger.warn(`[auth-check] 检测到登录页跳转，登录态失效，URL: ${url}`)
        onPageClosed('auth_expired')
      }
    }
  }

  const handlePageClose = () => {
    if (isDisconnecting() || isDisconnected()) {
      logger.info(`[page-close] 账号 ${accountId} 已经在断开中或已断开，忽略重复事件`)
      return
    }
    if (browserSession.page) {
      logger.info(`[page-close] 账号 ${accountId} 页面关闭`)
      dispatchClose(detectCloseReason('page'))
    }
  }

  const handleBrowserDisconnected = () => {
    if (isDisconnecting() || isDisconnected()) {
      logger.info(`[browser-disconnected] 账号 ${accountId} 已经在断开中或已断开，忽略重复事件`)
      return
    }
    logger.warn(`[browser-disconnected] 账号 ${accountId} 浏览器进程已断开`)
    browserDisconnectTimer = setTimeout(() => {
      logger.warn(`[browser-disconnected] 账号 ${accountId} 宽限期结束，按浏览器异常断开处理`)
      dispatchClose(detectCloseReason('browser'))
    }, BROWSER_DISCONNECT_GRACE_MS)
  }

  browserSession.page.on('framenavigated', handleFrameNavigated)
  browserSession.page.on('close', handlePageClose)
  browserSession.browser.on('disconnected', handleBrowserDisconnected)

  return () => {
    if (browserDisconnectTimer) {
      clearTimeout(browserDisconnectTimer)
      browserDisconnectTimer = null
    }
    browserSession.page.off('framenavigated', handleFrameNavigated)
    browserSession.page.off('close', handlePageClose)
    browserSession.browser.off('disconnected', handleBrowserDisconnected)
  }
}
