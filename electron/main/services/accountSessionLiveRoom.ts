import type { Page } from 'playwright'

type LoggerLike = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string, error?: unknown) => void
}

function buildDouyinLiveUrl(webcastId: string): string {
  return `https://live.douyin.com/${webcastId}`
}

function normalizeLiveRoomUrl(rawUrl?: string | null, baseUrl?: string): string | null {
  if (!rawUrl) return null

  let value = rawUrl.trim()
  if (!value) return null

  if (value.startsWith('//')) {
    value = `https:${value}`
  } else if (/^(live\.douyin\.com|live\.kuaishou\.com)\//i.test(value)) {
    value = `https://${value}`
  }

  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function isSupportedLiveRoomUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const href = url.toString()
    const host = url.hostname.toLowerCase()
    const path = url.pathname.replace(/\/+$/, '')

    if (
      href.includes('dashboard') ||
      href.includes('control') ||
      href.includes('compass') ||
      href.includes('buyin.jinritemai.com')
    ) {
      return false
    }

    if (host === 'live.douyin.com' || host === 'live.kuaishou.com') {
      return path.length > 1
    }

    return path.includes('/live/')
  } catch {
    return false
  }
}

export async function extractLiveRoomUrlFromPage(
  page: Page,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    const candidateUrls = new Set<string>()
    const pushCandidate = (value?: string | null) => {
      const normalized = normalizeLiveRoomUrl(value, page.url())
      if (normalized) {
        candidateUrls.add(normalized)
      }
    }

    const currentUrl = page.url()
    pushCandidate(currentUrl)

    const urlObj = new URL(currentUrl)
    for (const key of ['web_rid', 'webRid', 'webcast_id', 'webcastId']) {
      const webcastId = urlObj.searchParams.get(key)
      if (webcastId) {
        pushCandidate(buildDouyinLiveUrl(webcastId))
      }
    }

    const pageSignals = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll('a[href]'))
        .map(anchor => anchor.getAttribute('href') || anchor.getAttribute('data-href') || '')
        .filter(Boolean)

      const scriptText = Array.from(document.querySelectorAll('script'))
        .map(script => script.textContent || '')
        .filter(Boolean)
        .join('\n')

      return { hrefs, scriptText }
    })

    pageSignals.hrefs.forEach(href => pushCandidate(href))

    const pageContent = `${(await page.content()).replace(/\\\//g, '/')}\n${pageSignals.scriptText}`

    const directLiveUrlMatches = pageContent.match(/https?:\/\/live\.douyin\.com\/[A-Za-z0-9_-]+/g)
    directLiveUrlMatches?.forEach(match => pushCandidate(match))

    const protocolLessLiveUrlMatches = pageContent.match(
      /(?<!https?:\/\/)live\.douyin\.com\/[A-Za-z0-9_-]+/g,
    )
    protocolLessLiveUrlMatches?.forEach(match => pushCandidate(match))

    for (const pattern of [
      /"(?:web_rid|webRid|webcast_id|webcastId)"\s*:\s*"([A-Za-z0-9_-]+)"/g,
      /(?:web_rid|webRid|webcast_id|webcastId)\s*[:=]\s*"([A-Za-z0-9_-]+)"/g,
    ]) {
      for (const match of pageContent.matchAll(pattern)) {
        pushCandidate(buildDouyinLiveUrl(match[1]))
      }
    }

    for (const candidate of candidateUrls) {
      if (isSupportedLiveRoomUrl(candidate)) {
        logger.info(`识别到直播间链接候选: ${candidate}`)
        return candidate
      }
    }

    logger.warn(
      `未从页面中提取到真实直播间 URL；已跳过 room_id 直拼逻辑，候选数=${candidateUrls.size}`,
    )
    return null
  } catch (error) {
    logger.error('提取直播间 URL 失败:', error)
    return null
  }
}
