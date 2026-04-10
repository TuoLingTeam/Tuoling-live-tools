import { LIVE_CONTROL_DISCONNECT_REASONS } from 'shared/liveControlDisconnect'
import type { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import type { IPlatform } from '#/platforms/IPlatform'

type SessionLogger = ReturnType<typeof createLogger>

export async function verifyAccountSessionConnectionHealth(
  browserSession: BrowserSession | null,
  platform: IPlatform,
  logger: SessionLogger,
): Promise<{ healthy: boolean; reason?: string }> {
  try {
    if (!browserSession?.page) {
      return { healthy: false, reason: '浏览器页面不存在' }
    }

    try {
      const title = await browserSession.page.title()
      logger.info(`[健康检查] 页面标题: ${title}`)
    } catch {
      return { healthy: false, reason: '无法访问页面，页面可能已关闭或加载失败' }
    }

    try {
      const isLive = await platform.isLive(browserSession)
      logger.info(`[健康检查] 直播状态检测成功，当前状态: ${isLive ? '直播中' : '未直播'}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { healthy: false, reason: `直播状态检测失败: ${errorMsg}` }
    }

    return { healthy: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { healthy: false, reason: `健康检查异常: ${errorMsg}` }
  }
}

export function formatAccountSessionConnectError(
  error: unknown,
  options: {
    platformName?: string
    currentUrl?: string
  } = {},
) {
  if (error instanceof Error) {
    const errorMessage = error.message || error.name || ''
    if (
      errorMessage.includes('Target page, context or browser has been closed') ||
      errorMessage.includes('browser has been closed') ||
      errorMessage.includes('page has been closed')
    ) {
      return LIVE_CONTROL_DISCONNECT_REASONS.browserClosed
    }
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return '连接超时，请检查网络后重试'
    }
    if (errorMessage.includes('net::') || errorMessage.includes('Navigation failed')) {
      return '网络连接失败，请检查网络后重试'
    }
  }

  const baseMessage =
    error instanceof Error
      ? error.message || error.name
      : typeof error === 'string'
        ? error
        : error
          ? JSON.stringify(error)
          : '连接直播控制台失败'
  const details: string[] = []

  if (options.platformName) {
    details.push(`platform=${options.platformName}`)
  }
  if (options.currentUrl) {
    details.push(`url=${options.currentUrl}`)
  }

  return details.length ? `${baseMessage} (${details.join(', ')})` : baseMessage
}
