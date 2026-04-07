import { Result } from '@praha/byethrow'
import type { createLogger } from '#/logger'

type SessionLogger = ReturnType<typeof createLogger>

type RoomSession = {
  id: string
  name: string
  platform: LiveControlPlatform
  status: 'idle' | 'connecting' | 'connected' | 'error'
  page?: import('playwright').Page
  liveRoomUrl?: string
  liveRoomStatus: 'idle' | 'entering' | 'entered' | 'error'
  lastEnterError?: string
  error?: string
}

export async function enterSubAccountLiveRoom<TSession extends RoomSession>(params: {
  session: TSession
  liveRoomUrl: string
  logger: SessionLogger
  loggedInSelector: string
  getLiveRoomSelectors: (platform: LiveControlPlatform) => {
    inputSelector: string
    sendButtonSelector: string
    sendMethod: 'click' | 'enter'
  }
  isLikelyLiveRoomPage: (currentUrl?: string) => boolean
  notifyStatusChange: (accountId: string, status: TSession['status'], error?: string) => void
  notifySessionUpdate: (accountId: string) => void
  setLiveRoomState: (
    session: TSession,
    state: TSession['liveRoomStatus'],
    options?: { url?: string; error?: string },
  ) => void
}) {
  const {
    session,
    liveRoomUrl,
    logger,
    loggedInSelector,
    getLiveRoomSelectors,
    isLikelyLiveRoomPage,
    notifyStatusChange,
    notifySessionUpdate,
    setLiveRoomState,
  } = params

  if (session.status === 'connecting' && session.page && !session.page.isClosed()) {
    try {
      const isLoggedIn = await session.page
        .$(loggedInSelector)
        .then(el => !!el)
        .catch(() => false)

      if (isLoggedIn) {
        logger.info(`小号 ${session.name} 进入直播间前检测到登录成功，更新状态`)
        session.status = 'connected'
        session.error = undefined
        notifyStatusChange(session.id, 'connected')
      }
    } catch (checkError) {
      logger.warn(`小号 ${session.name} 登录状态检查失败:`, checkError)
    }
  }

  if (session.status !== 'connected' || !session.page) {
    logger.warn(
      `小号 ${session.name} 状态检查失败：status=${session.status}, hasPage=${!!session.page}`,
    )
    session.liveRoomStatus = 'error'
    session.lastEnterError = '小号未连接'
    session.liveRoomUrl = undefined
    return Result.fail(new Error('小号未连接'))
  }

  try {
    logger.info(`小号 ${session.name} 正在进入直播间：${liveRoomUrl}`)
    session.liveRoomUrl = undefined
    session.liveRoomStatus = 'entering'
    session.lastEnterError = undefined
    notifySessionUpdate(session.id)

    await session.page.goto(liveRoomUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    const urlAfterGoto = session.page.url()
    if (isLikelyLiveRoomPage(urlAfterGoto)) {
      setLiveRoomState(session, 'entered', { url: urlAfterGoto })
    }

    await session.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      logger.warn(`小号 ${session.name} 页面网络空闲等待超时，继续检测评论框`)
    })

    const urlAfterLoad = session.page.url()
    if (isLikelyLiveRoomPage(urlAfterLoad)) {
      setLiveRoomState(session, 'entered', { url: urlAfterLoad })
    }

    const selectors = getLiveRoomSelectors(session.platform)
    let inputFound = false
    const maxRetries = 3

    for (let i = 0; i < maxRetries && !inputFound; i++) {
      try {
        await session.page.waitForSelector(selectors.inputSelector, {
          timeout: 15000,
          state: 'visible',
        })
        inputFound = true
      } catch {
        logger.warn(`小号 ${session.name} 第 ${i + 1} 次等待评论框超时`)

        if (i < maxRetries - 1) {
          await session.page
            .evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight)
            })
            .catch(() => {})
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    }

    if (!inputFound) {
      const currentUrl = session.page.url()
      if (isLikelyLiveRoomPage(currentUrl)) {
        logger.info(`小号 ${session.name} 已在直播间页面，跳过评论框检测`)
      } else {
        throw new Error('等待评论输入框超时，可能直播间未开播或页面加载异常')
      }
    }

    setLiveRoomState(session, 'entered', { url: session.page.url() || liveRoomUrl })
    logger.success(`小号 ${session.name} 已进入直播间`)
    return Result.succeed(true)
  } catch (error) {
    session.liveRoomUrl = undefined
    session.liveRoomStatus = 'error'
    session.lastEnterError = error instanceof Error ? error.message : '进入直播间失败'
    notifySessionUpdate(session.id)
    logger.error(`小号 ${session.name} 进入直播间失败`, error)
    return Result.fail(error instanceof Error ? error : new Error('进入直播间失败'))
  }
}
