import type { Page, Response } from 'playwright'
import type { ICommentListener } from '../IPlatform'
import { SELECTORS, URLS } from './constant'

type ExtractedControlComment = {
  msg_id?: string
  nick_name?: string
  content?: string
  raw?: unknown
}

const CONTROL_COMMENT_ITEM_SELECTORS = [
  '#comment-list-wrapper div[class^="commentItem"]',
  '#comment-list-wrapper div[class*="commentItem"]',
  'div[class^="commentItem"]',
  'div[class*="commentItem"]',
]

const ID_KEYS = ['comment_id', 'commentId', 'msg_id', 'msgId', 'message_id', 'messageId', 'id']
const NICK_KEYS = [
  'nick_name',
  'nickName',
  'nickname',
  'user_nickname',
  'userNickname',
  'user_name',
  'userName',
  'screen_name',
  'screenName',
  'name',
]
const CONTENT_KEYS = [
  'content',
  'comment_content',
  'commentContent',
  'comment_text',
  'commentText',
  'text',
]
const TYPE_KEYS = ['msg_type', 'msgType', 'message_type', 'messageType', 'type']
const DOM_NOISE = new Set([
  '回复',
  '置顶',
  '取消置顶',
  '讲解',
  '取消讲解',
  '暂无评论数据',
  '暂无评论',
  '直播未开始',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]) {
  return keys.some(key => key in record)
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function shouldInspectControlResponse(url: string) {
  const lower = url.toLowerCase()
  if (
    !['jinritemai.com', 'douyin.com', 'byte', 'bytedance', 'ecom'].some(host =>
      lower.includes(host),
    )
  ) {
    return false
  }
  return ['comment', 'message', 'webcast', 'interaction', 'im/', 'live'].some(keyword =>
    lower.includes(keyword),
  )
}

function shouldTreatRecordAsComment(record: Record<string, unknown>, path: string[]) {
  const lowerPath = path.join('.').toLowerCase()
  const type = readString(record, TYPE_KEYS)?.toLowerCase() ?? ''
  const hasCommentField =
    hasAnyKey(record, ['comment_id', 'commentId']) ||
    hasAnyKey(record, ['comment_content', 'commentContent', 'comment_text'])

  return (
    lowerPath.includes('comment') || type.includes('comment') || type === 'text' || hasCommentField
  )
}

function buildCommentFromRecord(
  record: Record<string, unknown>,
  path: string[],
): ExtractedControlComment | null {
  const content = readString(record, CONTENT_KEYS)
  if (!content || !shouldTreatRecordAsComment(record, path)) return null

  const normalizedContent = normalizeText(content)
  if (!normalizedContent || normalizedContent.length > 500) return null

  const nickname = readString(record, NICK_KEYS)
  const id = readString(record, ID_KEYS)
  if (!nickname && !id && !hasAnyKey(record, ['comment_content', 'commentText'])) {
    return null
  }

  return {
    msg_id: id,
    nick_name: nickname,
    content: normalizedContent,
    raw: record,
  }
}

function dedupeComments(comments: ExtractedControlComment[]) {
  const seen = new Set<string>()
  return comments.filter(comment => {
    const key = [comment.msg_id ?? '', comment.nick_name ?? '', comment.content ?? ''].join(
      '\u0001',
    )
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractControlCommentsFromPayload(payload: unknown) {
  const comments: ExtractedControlComment[] = []

  const visit = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    if (!isRecord(value)) return

    const direct = buildCommentFromRecord(value, path)
    if (direct) comments.push(direct)

    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) || isRecord(child)) visit(child, [...path, key])
    }
  }

  visit(payload, [])
  return dedupeComments(comments)
}

export function parseControlDomCommentText(text: string): ExtractedControlComment | null {
  const lines = text
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(line => normalizeText(line))
    .filter(line => line && !DOM_NOISE.has(line))

  if (lines.length === 0) return null

  const joined = lines.join(' ')
  const colonMatch = joined.match(/^(.{1,24}?)[：:]\s*(.{1,500})$/)
  if (colonMatch) {
    return {
      nick_name: colonMatch[1].trim(),
      content: colonMatch[2].trim(),
      raw: { source: 'dom', text },
    }
  }

  if (lines.length >= 2) {
    const nickname = lines[0]
    const content = lines.slice(1).join(' ').trim()
    if (content && content !== nickname) {
      return {
        nick_name: nickname,
        content,
        raw: { source: 'dom', text },
      }
    }
  }

  const content = lines[0]
  if (content.length < 2 || content.length > 500) return null
  return {
    nick_name: '观众',
    content,
    raw: { source: 'dom', text },
  }
}

export class ControlListener implements ICommentListener {
  readonly _isCommentListener = true

  private isRunning = false
  private keepAliveInterval: NodeJS.Timeout | null = null
  private domPollInterval: NodeJS.Timeout | null = null
  private seenCommentKeys: string[] = []
  private handleComment: (comment: DouyinLiveMessage) => void = () => {}
  constructor(private page: Page) {
    this.handleResponse = this.handleResponse.bind(this)
  }

  startCommentListener(onComment: (comment: DouyinLiveMessage) => void) {
    this.handleComment = onComment
    this.isRunning = true
    this.page.off('response', this.handleResponse)
    this.page.on('response', this.handleResponse)
    this.startKeepAlive()
    this.startDomPolling()
    void this.scanVisibleComments()
  }

  stopCommentListener() {
    this.isRunning = false
    this.stopKeepAlive()
    this.stopDomPolling()
    this.page.off('response', this.handleResponse)
  }

  private async handleResponse(response: Response) {
    const url = response.url()
    if (!shouldInspectControlResponse(url)) {
      return
    }

    try {
      const body = await response.json()
      const comments = extractControlCommentsFromPayload(body)
      for (const comment of comments) {
        this.emitComment(comment)
      }
    } catch {
      // 中控台接口结构经常变化；忽略异常并保留 DOM 兜底监听。
    }
  }

  /**
   * 启动页面保活机制
   * 优化：使用 setInterval 替代递归调用，避免调用栈累积
   */
  private startKeepAlive() {
    this.stopKeepAlive() // 确保清理旧的定时器

    this.keepAliveInterval = setInterval(async () => {
      if (!this.isRunning) {
        this.stopKeepAlive()
        return
      }

      try {
        // 检查是否弹出了保护窗口
        for (const selector of Object.values(SELECTORS.overlays)) {
          const element = await this.page.$(selector)
          if (element) {
            await element.dispatchEvent('click')
          }
        }
        // 有新评论的话点击评论按钮
        const newCommentButton = await this.page.$(SELECTORS.NEW_COMMENT_LABEL)
        if (newCommentButton) {
          await newCommentButton.dispatchEvent('click')
        }
      } catch {
        // 页面可能已关闭，忽略错误
      }
    }, 3000)
  }

  /**
   * 停止页面保活机制
   */
  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }
  }

  private startDomPolling() {
    this.stopDomPolling()
    this.domPollInterval = setInterval(() => {
      void this.scanVisibleComments()
    }, 2000)
  }

  private stopDomPolling() {
    if (this.domPollInterval) {
      clearInterval(this.domPollInterval)
      this.domPollInterval = null
    }
  }

  private emitComment(comment: ExtractedControlComment) {
    const content = comment.content?.trim()
    if (!content) return false

    const key = `${comment.msg_id || ''}:${comment.nick_name || ''}:${content}`
    if (this.seenCommentKeys.includes(key)) return false
    this.seenCommentKeys.push(key)
    if (this.seenCommentKeys.length > 1000) {
      this.seenCommentKeys = this.seenCommentKeys.slice(-500)
    }

    this.handleComment({
      msg_id: comment.msg_id || key,
      nick_name: comment.nick_name || '观众',
      content,
      msg_type: 'comment',
      time: new Date().toLocaleTimeString(),
    })
    return true
  }

  private async scanVisibleComments() {
    if (!this.isRunning || this.page.isClosed()) return

    try {
      const items = await this.page.evaluate(selectors => {
        const seenNodes = new Set<Element>()
        const nodes: Element[] = []
        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach(node => {
            if (seenNodes.has(node)) return
            seenNodes.add(node)
            nodes.push(node)
          })
        }
        return nodes
          .filter(node => {
            const text = node.textContent?.trim() ?? ''
            return text.length > 0 && text.length < 800
          })
          .slice(-50)
          .map(node => node.textContent?.replace(/\s+/g, '\n').trim() ?? '')
      }, CONTROL_COMMENT_ITEM_SELECTORS)

      for (const text of items) {
        const comment = parseControlDomCommentText(text)
        if (comment) this.emitComment(comment)
      }
    } catch {
      // 页面切换和直播组件刷新时可能短暂不可读，下一轮继续扫描。
    }
  }

  getCommentListenerPage(): Page {
    return this.page
  }
}

interface CompassMessageResponse {
  data: {
    messages: {
      // 评论
      comment: CommentMessage[] | null
      // 进入直播间
      room_enter?: RoomEnterMessage[]
      // 点赞
      room_like?: RoomLikeMessage[]
      // 加入品牌会员
      subscribe_merchant_brand_vip?: SubscribeMerchantBrandVipMessage[]
      // 关注
      room_follow?: RoomFollowMessage[]
      // 加入粉丝团
      ecom_fansclub_participate?: EcomFansclubParticipateMessage[]
    }
  }
}

interface LiveOrderResponse {
  data: {
    item_num: number
    nick_name: string
    order_id: string
    order_status: number // 已知： 3 -> 已支付          0 -> 已下单
    order_ts: number
    product_id: string
    product_title: string
  }[]
  msg: string
}

export class CompassListener implements ICommentListener {
  readonly _isCommentListener = true

  protected compassPage: Page | undefined
  private handleComment: (comment: DouyinLiveMessage) => void = () => {}
  constructor(
    private platform: 'buyin' | 'douyin',
    protected page: Page,
  ) {}

  protected async connectCompass() {
    const getLiveRoomId = () => {
      return new Promise<string>((resolve, reject) => {
        const page = this.page
        const handleResponse = async (response: Response) => {
          const url = response.url()
          if (url.includes('promotions_v2?')) {
            const resData = await response.json()
            const roomId = resData?.data?.room_id
            if (roomId) {
              page.off('response', handleResponse)
              // this.logger.debug(`获取直播间 ID成功: ${roomId}`)
              resolve(roomId)
            }
          }
        }
        page.on('response', handleResponse)
        setTimeout(() => {
          page.off('response', handleResponse)
          reject(new Error('找不到直播间 ID，可能直播间已关闭'))
        }, 10000)
      })
    }

    const liveRoomId = await getLiveRoomId()

    const browserContext = this.page.context()
    this.compassPage = await browserContext.newPage()

    await this.compassPage.goto(
      this.platform === 'douyin'
        ? URLS.DOUYIN_COMPASS_INDEX_PREFIX
        : URLS.BUYIN_COMPASS_INDEX_PREFIX,
    )
    // this.logger.debug('正在尝试登录电商罗盘')
    // 等待罗盘自动登录
    await this.compassPage.waitForSelector(SELECTORS.COMPASS_LOGGED_IN)
    // this.logger.debug('登录成功，正在进入大屏')
    // 再进入大屏
    await this.compassPage.goto(
      `${
        this.platform === 'douyin'
          ? URLS.DOUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
          : URLS.BUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
      }${liveRoomId}`,
    )
    // 删除中间的直播画面，减少不必要的资源占用
    this.compassPage.locator('video').evaluate(el => {
      const video = el as HTMLVideoElement
      // 删太快也不行，找不到更好的方法之前只能死等一会了
      setTimeout(() => {
        video.pause()
        video.removeAttribute('src')
        video.load()
        video.remove()
      }, 3000)
    })
    // this.logger.debug('大屏进入成功')
  }

  private listenResponse() {
    const handleResponse = async (response: Response) => {
      const url = response.url()
      if (url.includes('message?')) {
        const data: CompassMessageResponse = await response.json()
        this.handleMessageResponse(data)
      } else if (url.includes('live_order_stream?')) {
        const data: LiveOrderResponse = await response.json()
        this.handleLiveOrderResponse(data)
      }
    }

    this.compassPage?.on('response', handleResponse)
  }

  private handleMessageResponse(data: CompassMessageResponse) {
    for (const messages of Object.values(data.data.messages)) {
      if (!messages) continue
      for (const message of messages) {
        const comment = { ...message, time: new Date().toLocaleTimeString() }
        this.handleComment(comment)
      }
    }
  }

  private handleLiveOrderResponse(data: LiveOrderResponse) {
    const messages: LiveOrderMessage[] = data.data.map(item => {
      let order_status: LiveOrderMessage['order_status'] = '未知状态'
      // TODO: 不确定已下单对应的是多少！
      if (item.order_status <= 1) {
        order_status = '已下单'
      } else if (item.order_status === 3) {
        order_status = '已付款'
      }
      return {
        msg_type: 'live_order',
        msg_id: `${item.order_id}#${item.order_status}`,
        nick_name: item.nick_name,
        order_status,
        order_ts: item.order_ts,
        product_id: item.product_id,
        product_title: item.product_title,
      }
    })
    for (const message of messages) {
      const comment = {
        ...message,
        time: new Date().toLocaleTimeString(),
      }
      this.handleComment(comment)
    }
  }

  async startCommentListener(onComment: (comment: DouyinLiveMessage) => void) {
    this.handleComment = onComment
    await this.connectCompass()
    this.listenResponse()
  }

  stopCommentListener() {
    this.compassPage?.removeAllListeners('response')
    this.compassPage?.close()
    // 优化：关闭后置空，避免内存泄漏
    this.compassPage = undefined
  }

  getCommentListenerPage(): Page {
    return this.compassPage ?? this.page
  }
}
