import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { PageNotFoundError } from '#/errors/PlatformError'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { sleep } from '#/utils'
import {
  comment,
  connect,
  ensurePage,
  getAllGoodsIdsFromScroller,
  getAllGoodsMetaFromScroller,
  getItemFromVirtualScroller,
  openUrlByElement,
  scanGoodsKnowledgeFromItem,
} from '../helper'
import type {
  ICommentListener,
  IPerformComment,
  IPerformPopup,
  IPlatform,
  IPopupGoodsScanner,
} from '../IPlatform'
import { TaobaoCommentListener } from './commentListener'
import { REGEXPS, SELECTORS, URLS } from './constant'
import { taobaoElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '淘宝' as const
const LIVE_ID_SELECTORS = [
  SELECTORS.LIVE_ID,
  '#scrollableDiv .tblalm-lm-list-item-live.online',
  '.tblalm-lm-list-item-live.online',
  '[href*="liveId="]',
  '[data-live-id]',
  '[data-liveid]',
]
const CONTROL_READY_SELECTORS = [
  SELECTORS.commentInput.TEXTAREA,
  '#comment-page',
  SELECTORS.GOODS_ITEMS_WRAPPER,
  SELECTORS.GOODS_ITEM,
]
const LIVE_ID_WAIT_TIMEOUT_MS = 15_000
const CONTROL_NAVIGATION_TIMEOUT_MS = 45_000
const CONTROL_READY_TIMEOUT_MS = 30_000
const DRIVER_OVERLAY_WAIT_MS = 3_000
const DRIVER_OVERLAY_DISMISS_ATTEMPTS = 8
const DRIVER_OVERLAY_DISMISS_INTERVAL_MS = 500

function normalizeLiveId(value: string | null | undefined): string | null {
  const compactValue = value?.replace(/\s+/g, '') ?? ''
  if (!compactValue) {
    return null
  }

  const liveIdMatch = compactValue.match(/liveId[=:](\d{8,})/i)
  if (liveIdMatch?.[1]) {
    return liveIdMatch[1]
  }

  return compactValue.match(/\d{8,}/)?.[0] ?? null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isNavigationRerenderError(error: unknown) {
  const message = getErrorMessage(error)
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id')
  )
}

function getPageUrl(page: Page) {
  try {
    return page.url()
  } catch {
    return ''
  }
}

function isTaobaoControlUrl(url: string) {
  return url.includes('/restful/index/live/control')
}

/**
 * 淘宝
 */
export class TaobaoPlatform
  implements IPlatform, IPerformPopup, IPerformComment, ICommentListener, IPopupGoodsScanner
{
  readonly _isCommentListener = true
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly _isPopupGoodsScanner = true
  private mainPage: Page | null = null
  private commentListener: TaobaoCommentListener | null = null

  async connect(session: BrowserSession): Promise<boolean> {
    const { page } = session
    const isAccessed = await connect(page, {
      liveControlUrl: URLS.LIVE_LIST, // 直播计划页面
      isInLiveControlSelector: SELECTORS.IN_LIVE_LIST,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })

    if (!isAccessed) {
      return false
    }

    // 淘宝需要在直播计划中获取到直播间 id，再通过 id 进入中控台
    console.info('[淘宝平台] 直播计划页已打开，开始查找正在直播的直播间 ID')
    const liveId = await this.findLiveId(page)
    if (!liveId) {
      throw new Error('未检测到正在直播的淘宝直播间，请确认淘宝直播已经开播')
    }

    const liveControlUrl = `${URLS.LIVE_CONTROL_WITH_ID}${liveId}`
    console.info(`[淘宝平台] 已找到直播间 ID: ${liveId}，开始进入直播中控台`)
    await this.gotoLiveControl(page, liveControlUrl)

    // 淘宝会弹出莫名其妙的引导界面，按 ESC 关闭
    await this.dismissDriverOverlay(page)
    await this.waitForControlReady(page)

    this.mainPage = page

    return true
  }

  private async findLiveId(page: Page): Promise<string | null> {
    await page.waitForSelector(SELECTORS.IN_LIVE_LIST, {
      timeout: LIVE_ID_WAIT_TIMEOUT_MS,
    })

    const deadline = Date.now() + LIVE_ID_WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      for (const selector of LIVE_ID_SELECTORS) {
        const liveId = await this.extractLiveIdFromSelector(page, selector)
        if (liveId) {
          return liveId
        }
      }

      await sleep(500)
    }

    return null
  }

  private async extractLiveIdFromSelector(page: Page, selector: string): Promise<string | null> {
    try {
      const values = await page.$$eval(selector, elements =>
        elements.flatMap(element => [
          element.textContent ?? '',
          element.getAttribute('href') ?? '',
          element.getAttribute('data-live-id') ?? '',
          element.getAttribute('data-liveid') ?? '',
          element.getAttribute('data-id') ?? '',
        ]),
      )

      for (const value of [...values, values.join('')]) {
        const liveId = normalizeLiveId(value)
        if (liveId) {
          return liveId
        }
      }
    } catch (error) {
      if (!isNavigationRerenderError(error)) {
        console.warn(`[淘宝平台] 读取直播间 ID 失败，selector=${selector}:`, error)
      }
    }

    return null
  }

  private async gotoLiveControl(page: Page, liveControlUrl: string) {
    try {
      await page.goto(liveControlUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONTROL_NAVIGATION_TIMEOUT_MS,
      })
    } catch (error) {
      const currentUrl = getPageUrl(page)
      if (!isTaobaoControlUrl(currentUrl)) {
        console.warn('[淘宝平台] 进入直播中控台失败：', error)
        throw new Error(`进入淘宝直播中控台失败，当前页面：${currentUrl || '未知页面'}`)
      }

      console.warn('[淘宝平台] 中控台跳转超时，但当前页面已进入中控台，继续等待核心控件')
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => null)
  }

  private async dismissDriverOverlay(page: Page) {
    const driverOverlay = SELECTORS.overlays.DRIVER
    await page.waitForSelector(driverOverlay, { timeout: DRIVER_OVERLAY_WAIT_MS }).catch(() => null)

    for (let attempt = 0; attempt < DRIVER_OVERLAY_DISMISS_ATTEMPTS; attempt++) {
      const overlay = await this.querySelectorDuringNavigation(page, driverOverlay)
      if (!overlay) {
        return
      }

      await page.press('body', 'Escape').catch(error => {
        console.warn('[淘宝平台] 关闭引导遮罩失败，将继续重试：', error)
      })
      await sleep(DRIVER_OVERLAY_DISMISS_INTERVAL_MS)
    }

    const overlay = await this.querySelectorDuringNavigation(page, driverOverlay)
    if (overlay) {
      throw new Error('淘宝直播中控台引导遮罩未关闭，请在浏览器中手动关闭后重试')
    }
  }

  private async querySelectorDuringNavigation(page: Page, selector: string) {
    try {
      return await page.$(selector)
    } catch (error) {
      if (!isNavigationRerenderError(error)) {
        throw error
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => null)
      return null
    }
  }

  private async waitForControlReady(page: Page) {
    const readySelector = CONTROL_READY_SELECTORS.join(', ')
    try {
      await page.waitForSelector(readySelector, {
        timeout: CONTROL_READY_TIMEOUT_MS,
      })
      console.info('[淘宝平台] 直播中控台核心控件已就绪')
    } catch (error) {
      const currentUrl = getPageUrl(page)
      if (!isTaobaoControlUrl(currentUrl)) {
        throw new Error(
          `淘宝直播中控台跳转失败，当前页面未停留在中控台：${currentUrl || '未知页面'}`,
        )
      }

      console.warn('[淘宝平台] 等待中控台核心控件超时：', error)
      throw new Error('淘宝直播中控台加载超时：未检测到评论区或商品区核心控件，请刷新中控台后重试')
    }
  }

  async login(session: BrowserSession): Promise<void> {
    if (!REGEXPS.LOGIN_PAGE.test(session.page.url())) {
      await session.page.goto(URLS.LOGIN_PAGE)
    }

    await session.page.waitForSelector(SELECTORS.IN_LIVE_LIST, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession): Promise<string> {
    // 需要前往首页获取
    const homePage = await openUrlByElement(session.page, URLS.HOME_PAGE)
    session.page.bringToFront()

    try {
      // 等待页面加载完成，最多等待 10 秒
      await homePage
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => homePage.waitForTimeout(3000)) // 如果 networkidle 超时，至少等待 3 秒

      // 尝试多种选择器查找用户名
      const selectors = SELECTORS.ACCOUNT_NAME.split(', ')
      let accountName = ''

      for (const selector of selectors) {
        try {
          const element = await homePage.waitForSelector(selector.trim(), { timeout: 3000 })
          if (element) {
            const text = await element.textContent()
            if (text?.trim()) {
              accountName = text.trim()
              break // 找到有效的用户名，跳出循环
            }
          }
        } catch (_error) {}
      }

      // 如果还是没找到，尝试从页面标题或其他位置获取
      if (!accountName || !accountName.trim()) {
        console.warn('[淘宝平台] 未找到用户名元素，尝试备用方案...')
        // 尝试从页面标题获取
        const pageTitle = await homePage.title()
        if (pageTitle.includes('淘宝直播')) {
          accountName = '淘宝主播' // 默认名称
        }
      }

      return accountName.trim() || '未知用户'
    } catch (error) {
      console.error('[淘宝平台] 获取用户名时发生错误:', error)
      throw new Error(`获取用户名失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      // 延迟关闭页面，确保数据已读取
      setTimeout(() => homePage.close().catch(() => {}), 500)
    }
  }

  async isLive(session: BrowserSession): Promise<boolean> {
    try {
      // 使用传入的 session.page，不使用缓存的 this.mainPage
      const page = session.page
      if (!page) {
        return false
      }
      // 同步当前有效页面，避免发送评论时仍使用过期的 mainPage
      this.mainPage = page
      const commentTextareaSelector = elementFinder.commentInput?.TEXTAREA
      const commentTextarea = commentTextareaSelector
        ? await page.$(commentTextareaSelector).catch(() => null)
        : null
      // 淘宝：如果能访问中控台页面，说明正在直播
      // 因为 connect() 中已经检查过，找不到 liveId 会抛出错误
      // 进一步检查：评论输入框是否存在
      return commentTextarea !== null
    } catch (_error) {
      return false
    }
  }

  disconnect(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async performPopup(id: number) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.inspect(btn => btn.dispatchEvent('click')),
      Result.andThen(_ => Result.succeed()),
    )
  }

  async performComment(message: string) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, false)),
    )
  }

  async scanPopupGoodsIds() {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getAllGoodsIdsFromScroller(page, elementFinder)),
    )
  }

  async scanPopupGoodsMeta() {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getAllGoodsMetaFromScroller(page, elementFinder)),
    )
  }

  async scanPopupGoodsKnowledge(goodsId: number) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(async page => {
        const itemResult = await getItemFromVirtualScroller(page, elementFinder, goodsId)
        if (Result.isFailure(itemResult)) {
          return itemResult
        }
        return await scanGoodsKnowledgeFromItem(page, itemResult.value, elementFinder, goodsId)
      }),
    )
  }

  startCommentListener(
    onComment: (comment: LiveMessage) => void,
    source: CommentListenerConfig['source'],
  ): void | Promise<void> {
    if (source !== 'taobao') {
      throw new Error('淘宝评论监听器只能用于淘宝平台')
    }
    if (!this.mainPage) {
      throw new PageNotFoundError()
    }
    this.commentListener = new TaobaoCommentListener(this.mainPage, onComment)
    this.commentListener.start()
  }

  stopCommentListener(): void {
    this.commentListener?.stop()
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new PageNotFoundError()
    }
    return this.commentListener.getPage()
  }

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  get platformName() {
    return PLATFORM_NAME
  }
}
