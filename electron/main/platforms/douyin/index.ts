import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import {
  comment,
  connect,
  ensurePage,
  getAccountName,
  getAllGoodsIdsFromScroller,
  getAllGoodsMetaFromScroller,
  getItemFromVirtualScroller,
  openUrlByElement,
  scanGoodsKnowledgeFromItem,
  toggleButton,
} from '../helper'
import type {
  BrowserlessRuntimeHydration,
  IBrowserlessRuntimePlatform,
  ICommentListener,
  IPerformComment,
  IPerformPopup,
  IPlatform,
  IPopupGoodsScanner,
  LiveDetectionResult,
} from '../IPlatform'
import { BrowserlessDouyinRuntime } from './browserlessRuntime'
import { CompassListener, ControlListener } from './commentListener'
import { REGEXPS, SELECTORS, TEXTS, URLS } from './constant'
import { douyinElementFinder as elementFinder } from './element-finder'

const PLATFORM_NAME = '抖音小店' as const
const logger = createLogger('DouyinPlatform')

/**
 * 抖音小店
 */
export class DouyinPlatform
  implements
    IPlatform,
    IPerformPopup,
    IPerformComment,
    ICommentListener,
    IPopupGoodsScanner,
    IBrowserlessRuntimePlatform
{
  readonly _isPerformComment = true
  readonly _isPerformPopup = true
  readonly _isCommentListener = true
  readonly _isPopupGoodsScanner = true
  readonly _isBrowserlessRuntimePlatform = true

  public mainPage: Page | null = null
  private commentListener: ICommentListener | null = null
  protected isHeadlessSession = false
  private readonly browserlessRuntime = new BrowserlessDouyinRuntime(
    'douyin',
    logger.scope('Browserless'),
    session => this.connect(session),
  )

  async connect(browserSession: BrowserSession) {
    const { page } = browserSession
    this.isHeadlessSession = browserSession.isHeadless
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL_PAGE,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })
    if (isConnected) {
      this.mainPage = page
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    // 进入登录页面
    // 抖店目前 (2025.6.29) 有一个小反爬，会打乱登录页面的样式
    // 解决方法：通过控件主动打开登录页面
    const newPage = await openUrlByElement(browserSession.page, URLS.LOGIN_PAGE)
    await browserSession.page.close()
    browserSession.page = newPage

    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    const accountName = await getAccountName(session.page, SELECTORS.ACCOUNT_NAME)
    return accountName ?? ''
  }

  async isLive(session: BrowserSession): Promise<LiveDetectionResult> {
    if (this.browserlessRuntime.hasRuntime() && (!session || session.page.isClosed())) {
      return await this.browserlessRuntime.isLiveWithoutBrowser()
    }

    try {
      // 使用传入的 session.page，不使用缓存的 this.mainPage
      // 避免页面刷新/重定向后引用失效的问题
      const page = session.page
      if (!page || page.isClosed()) {
        return 'unknown'
      }
      // 同步当前有效页面，避免自动发言仍然使用旧的 mainPage
      this.mainPage = page
      // 检测评论输入框是否存在且可用（开播时会有评论输入框）
      const commentTextarea = await page.$(SELECTORS.commentInput.TEXTAREA).catch(() => null)
      if (commentTextarea) {
        const isDisabled = await commentTextarea.isDisabled().catch(() => true)
        // 如果评论框存在且未禁用，说明正在直播
        if (!isDisabled) {
          return true
        }
      }

      const liveTag = await page.$(SELECTORS.LIVE_TAG).catch(() => null)
      if (liveTag) {
        return true
      }

      const noLiveData = await page.$(SELECTORS.NO_LIVE_DATA).catch(() => null)
      if (noLiveData) {
        return false
      }

      return 'unknown'
    } catch (_error) {
      return 'unknown'
    }
  }

  async disconnect(): Promise<void> {
    await this.stopCommentListener()
    await this.browserlessRuntime.close()
    this.mainPage = null
  }

  async performPopup(id: number, signal?: AbortSignal) {
    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => getItemFromVirtualScroller(page, elementFinder, id)),
      Result.andThen(item => elementFinder.getPopUpButtonFromGoodsItem(item)),
      Result.andThen(popupBtn =>
        toggleButton(popupBtn, TEXTS.POPUP_BUTTON, TEXTS.POPUP_BUTTON_CANCLE, signal),
      ),
    )
  }

  async performComment(message: string, pinTop: boolean) {
    if ((!this.mainPage || this.mainPage.isClosed()) && this.browserlessRuntime.hasRuntime()) {
      return await this.browserlessRuntime.performComment(message, pinTop)
    }

    return Result.pipe(
      ensurePage(this.mainPage),
      Result.andThen(page => comment(page, elementFinder, message, pinTop)),
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

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
  }

  startCommentListener(onComment: (comment: LiveMessage) => void, source: 'control' | 'compass') {
    if (this.browserlessRuntime.hasRuntime() && this.isHeadlessSession) {
      return this.browserlessRuntime.startCommentListener(onComment)
    }

    Result.pipe(
      ensurePage(this.mainPage),
      Result.map(page => {
        const effectiveSource = this.isHeadlessSession && source === 'control' ? 'compass' : source
        if (effectiveSource !== source) {
          logger.info(
            `[comments] headless session maps comment source ${source} -> ${effectiveSource}`,
          )
        }
        if (effectiveSource === 'control') {
          this.commentListener = new ControlListener(page)
        } else {
          this.commentListener = new CompassListener('douyin', page)
        }
        return this.commentListener.startCommentListener(onComment, effectiveSource)
      }),
      Result.unwrap(),
    )
  }

  stopCommentListener(): void | Promise<void> {
    return Promise.resolve(this.commentListener?.stopCommentListener()).then(() =>
      this.browserlessRuntime.stopCommentListener(),
    )
  }

  getCommentListenerPage(): Page {
    if (!this.commentListener) {
      throw new Error('未找到评论监听页面')
    }
    return this.commentListener?.getCommentListenerPage() ?? this.mainPage
  }

  handleComment(): void {
    throw new Error('Method not implemented.')
  }

  get platformName() {
    return PLATFORM_NAME
  }

  async hydrateBrowserlessRuntime(config: BrowserlessRuntimeHydration) {
    return await this.browserlessRuntime.hydrate(config)
  }

  hasBrowserlessRuntime() {
    return this.browserlessRuntime.hasRuntime()
  }

  canStartTaskWithoutBrowser(taskType: LiveControlTask['type']) {
    return this.browserlessRuntime.canStartTaskWithoutBrowser(taskType)
  }

  async isLiveWithoutBrowser() {
    return await this.browserlessRuntime.isLiveWithoutBrowser()
  }
}
