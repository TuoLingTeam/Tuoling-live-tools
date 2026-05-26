import type { Result } from '@praha/byethrow'
import type { Page } from 'playwright'
import type { PlatformError } from '#/errors/PlatformError'
import type { BrowserSession, StorageState } from '#/managers/BrowserSessionManager'

export interface ICommentListener {
  _isCommentListener: true
  startCommentListener(
    onComment: (comment: LiveMessage) => void,
    /** 暂定，control 为中控台互动评论监听， compass 为直播大屏监听 */
    source: CommentListenerConfig['source'],
  ): void | Promise<void>
  stopCommentListener(): void | Promise<void>
  getCommentListenerPage(): Page
}

export function isCommentListener(platform: IPlatform): platform is IPlatform & ICommentListener {
  return '_isCommentListener' in platform && platform._isCommentListener === true
}

export interface BrowserlessRuntimeHydration {
  accountId: string
  platformId: LiveControlPlatform
  storageState: StorageState
  browserSession?: BrowserSession | null
}

export interface IBrowserlessRuntimePlatform {
  _isBrowserlessRuntimePlatform: true
  hydrateBrowserlessRuntime(config: BrowserlessRuntimeHydration): Promise<boolean>
  hasBrowserlessRuntime(): boolean
  canStartTaskWithoutBrowser(taskType: LiveControlTask['type']): boolean
  isLiveWithoutBrowser(): Promise<LiveDetectionResult>
}

export function isBrowserlessRuntimePlatform(
  platform: IPlatform,
): platform is IPlatform & IBrowserlessRuntimePlatform {
  return (
    '_isBrowserlessRuntimePlatform' in platform && platform._isBrowserlessRuntimePlatform === true
  )
}

export interface IPerformPopup {
  _isPerformPopup: true
  /** 弹窗指定商品序号 */
  performPopup(id: number, signal?: AbortSignal): Result.ResultAsync<void, Error>
  /** 获取弹窗任务所需的页面 */
  getPopupPage(): Page | null
}

export function isPerformPopup(platform: IPlatform): platform is IPlatform & IPerformPopup {
  return '_isPerformPopup' in platform && platform._isPerformPopup === true
}

export interface IPopupGoodsScanner {
  _isPopupGoodsScanner: true
  /** 扫描当前直播中控台/商品页上的商品序号，用于自动填充 */
  scanPopupGoodsIds(): Result.ResultAsync<number[], Error>
  scanPopupGoodsMeta?(): Result.ResultAsync<Array<{ id: number; title?: string }>, Error>
  scanPopupGoodsKnowledge?(goodsId: number): Result.ResultAsync<
    {
      id: number
      title?: string
      priceText?: string
      detailText?: string
      source: 'detail-page' | 'list-item'
    },
    Error
  >
}

export function isPopupGoodsScanner(
  platform: IPlatform,
): platform is IPlatform & IPopupGoodsScanner {
  return '_isPopupGoodsScanner' in platform && platform._isPopupGoodsScanner === true
}

export interface IPerformComment {
  _isPerformComment: true
  /** 在互动评论区域发送评论，返回结果表示是否成功置顶 */
  performComment(message: string, pinTop?: boolean): Result.ResultAsync<boolean, PlatformError>
  /** 获取评论任务所需的页面 */
  getCommentPage(): Page | null
}

export function isPerformComment(platform: IPlatform): platform is IPlatform & IPerformComment {
  return '_isPerformComment' in platform && platform._isPerformComment === true
}

export interface IPinComment {
  _isPinComment: true
  /** 置顶评论 */
  pinComment(comment: string, signal?: AbortSignal): Result.ResultAsync<void, PlatformError>
  /** 获取置顶评论任务所需的页面 */
  getPinCommentPage(): Page | null
}

export function isPinComment(platform: IPlatform): platform is IPlatform & IPinComment {
  return '_isPinComment' in platform && platform._isPinComment === true
}

export interface IPlatform {
  get platformName(): string
  /** 连接到中控台，最终停留在中控台页面 */
  connect(browserSession: BrowserSession): Promise<boolean>
  /** 登录 */
  login(browserSession: BrowserSession): Promise<void>
  /** 在中控台页面获取用户名 */
  getAccountName(session: BrowserSession): Promise<string>
  /** 检测是否正在直播 */
  isLive(session: BrowserSession): Promise<LiveDetectionResult>

  disconnect(): Promise<void>
}

export type LiveDetectionResult = boolean | 'unknown'
