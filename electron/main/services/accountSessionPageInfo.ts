import type { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { extractLiveRoomUrlFromPage, isSupportedLiveRoomUrl } from './accountSessionLiveRoom'
import { getAuthExpiredLoginPatterns, matchesAuthExpiredLoginPage } from './authPlatform'

type SessionLogger = ReturnType<typeof createLogger>

export function getAccountSessionCurrentUrl(
  browserSession: BrowserSession | null,
  logger: SessionLogger,
): string | null {
  try {
    if (browserSession?.page) {
      return browserSession.page.url()
    }
    return null
  } catch (error) {
    logger.error('获取当前页面 URL 失败:', error)
    return null
  }
}

export async function getAccountSessionLiveRoomUrl(params: {
  browserSession: BrowserSession | null
  logger: SessionLogger
}) {
  const { browserSession, logger } = params

  try {
    if (!browserSession?.page) {
      return { success: false as const, error: '浏览器页面不存在' }
    }

    const page = browserSession.page
    const currentUrl = page.url()

    if (isSupportedLiveRoomUrl(currentUrl)) {
      logger.info(`当前已是直播间页面: ${currentUrl}`)
      return { success: true as const, url: currentUrl }
    }

    if (currentUrl.includes('buyin.jinritemai.com') || currentUrl.includes('douyin.com')) {
      const liveRoomUrl = await extractLiveRoomUrlFromPage(page, logger)
      if (liveRoomUrl) {
        logger.info(`从中控台提取到直播间 URL: ${liveRoomUrl}`)
        return { success: true as const, url: liveRoomUrl }
      }
    }

    return {
      success: false as const,
      error: '当前不在直播间页面，也无法提取到真实可访问的直播间链接',
    }
  } catch (error) {
    logger.error('获取直播间 URL 失败:', error)
    return {
      success: false as const,
      error: error instanceof Error ? error.message : '获取直播间 URL 失败',
    }
  }
}

export function isAccountSessionAuthExpired(
  platform: LiveControlPlatform,
  url: string,
  logger: SessionLogger,
): boolean {
  const patterns = getAuthExpiredLoginPatterns(platform)

  if (patterns.length === 0) {
    logger.warn(`[isAuthExpired] 未知平台: ${platform}，无法检测登录态`)
    return false
  }

  const isLoginPage = matchesAuthExpiredLoginPage(platform, url)

  if (isLoginPage) {
    logger.info(`[isAuthExpired] 平台 ${platform} 匹配到登录页: ${url}`)
  }

  return isLoginPage
}
