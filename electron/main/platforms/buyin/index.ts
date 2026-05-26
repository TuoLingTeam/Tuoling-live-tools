import { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import { createLogger } from '#/logger'
import type { BrowserSession } from '#/managers/BrowserSessionManager'
import { DouyinPlatform } from '../douyin'
import { BrowserlessDouyinRuntime } from '../douyin/browserlessRuntime'
import { CompassListener, ControlListener } from '../douyin/commentListener'
// 百应和抖店共用
import { connect, ensurePage, openUrlByElement } from '../helper'
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
import { REGEXPS, SELECTORS, URLS } from './constant'

const PLATFORM_NAME = '巨量百应' as const
const logger = createLogger('BuyinPlatform')

/**
 * 巨量百应
 */
export class BuyinPlatform
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

  private mainPage: Page | null = null
  private commentListener: ICommentListener | null = null
  private isHeadlessSession = false
  private readonly browserlessRuntime = new BrowserlessDouyinRuntime(
    'buyin',
    logger.scope('Browserless'),
    session => this.connect(session),
  )

  get platformName() {
    return PLATFORM_NAME
  }

  async connect(browserSession: BrowserSession) {
    const { page } = browserSession
    this.isHeadlessSession = browserSession.isHeadless
    const isConnected = await connect(page, {
      isInLiveControlSelector: SELECTORS.IN_LIVE_CONTROL,
      liveControlUrl: URLS.LIVE_CONTROL_PAGE,
      loginUrlRegex: REGEXPS.LOGIN_PAGE,
    })
    if (isConnected) {
      // 2025.11 巨量百应的中控台和登录时一样，样式会乱，同样的解决方法
      const newPage = await openUrlByElement(page, URLS.LIVE_CONTROL_PAGE)
      browserSession.page = newPage
      this.mainPage = newPage
      await page.close()
    }
    return isConnected
  }

  async login(browserSession: BrowserSession) {
    // 进入登录页面
    // 巨量百应（2025.8）也有和抖店同样的问题
    // 解决方法：通过控件主动打开登录页面
    const newPage = await openUrlByElement(browserSession.page, URLS.LOGIN_PAGE)
    await browserSession.page.close()
    browserSession.page = newPage

    await browserSession.page.waitForSelector(SELECTORS.LOGGED_IN, {
      timeout: 0,
    })
  }

  async getAccountName(session: BrowserSession) {
    await session.page.waitForSelector(SELECTORS.ACCOUNT_NAME)
    const accountName = await session.page.$(SELECTORS.ACCOUNT_NAME).then(el => el?.textContent())
    return accountName ?? ''
  }

  async isLive(session: BrowserSession): Promise<LiveDetectionResult> {
    if (this.browserlessRuntime.hasRuntime() && (!session || session.page.isClosed())) {
      return await this.browserlessRuntime.isLiveWithoutBrowser()
    }
    // 百应和抖店共用相同的检测逻辑
    return await DouyinPlatform.prototype.isLive.call(this, session)
  }

  async disconnect(): Promise<void> {
    await this.stopCommentListener()
    await this.browserlessRuntime.close()
    this.mainPage = null
  }

  async performPopup(...args: Parameters<IPerformPopup['performPopup']>) {
    return await DouyinPlatform.prototype.performPopup.call(this, ...args)
  }

  async performComment(message: string, pinTop: boolean) {
    if ((!this.mainPage || this.mainPage.isClosed()) && this.browserlessRuntime.hasRuntime()) {
      return await this.browserlessRuntime.performComment(message, pinTop)
    }
    return await DouyinPlatform.prototype.performComment.call(this, message, pinTop)
  }

  async scanPopupGoodsIds() {
    return await DouyinPlatform.prototype.scanPopupGoodsIds.call(this)
  }

  async scanPopupGoodsMeta() {
    return await DouyinPlatform.prototype.scanPopupGoodsMeta.call(this)
  }

  async scanPopupGoodsKnowledge(goodsId: number) {
    return await DouyinPlatform.prototype.scanPopupGoodsKnowledge.call(this, goodsId)
  }

  startCommentListener(onComment: (comment: LiveMessage) => void, source: 'control' | 'compass') {
    if (this.browserlessRuntime.hasRuntime() && this.isHeadlessSession) {
      return this.browserlessRuntime.startCommentListener(onComment)
    }

    const pageResult = ensurePage(this.mainPage)
    if (Result.isFailure(pageResult)) {
      throw pageResult.error
    }
    const page = pageResult.value
    const effectiveSource = this.isHeadlessSession && source === 'control' ? 'compass' : source
    if (effectiveSource !== source) {
      logger.info(`[comments] headless session maps comment source ${source} -> ${effectiveSource}`)
    }
    if (effectiveSource === 'control') {
      this.commentListener = new ControlListener(page)
    } else {
      this.commentListener = new CompassListener('buyin', page)
    }
    return this.commentListener.startCommentListener(onComment, effectiveSource)
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

  getPopupPage() {
    return this.mainPage
  }

  getCommentPage() {
    return this.mainPage
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
