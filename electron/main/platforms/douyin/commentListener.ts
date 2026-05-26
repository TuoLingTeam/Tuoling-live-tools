import type { Page, Response } from 'playwright'
import type { ICommentListener } from '../IPlatform'
import { SELECTORS, URLS } from './constant'

export type ExtractedControlComment = {
  msg_id?: string
  nick_name?: string
  content?: string
  raw?: unknown
}

const CONTROL_DOM_POLL_ACTIVE_MS = 2000
const CONTROL_DOM_POLL_IDLE_MS = 8000
const CONTROL_DOM_RECENT_COMMENT_WINDOW_MS = 30_000
const CONTROL_KEEP_ALIVE_MS = 10_000

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
const CONTROL_NICKNAME_STATUS_PREFIX_RE =
  /^(潜在新客|新客|老客|优质用户|普通用户|待支付|已加购|已下单|已支付|已付款|粉丝|会员)\s*/u

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

function normalizeControlNickname(value?: string) {
  const original = normalizeText(value ?? '')
  if (!original) return '观众'

  let normalized = original
  while (true) {
    const next = normalized.replace(CONTROL_NICKNAME_STATUS_PREFIX_RE, '').trim()
    if (!next || next === normalized) break
    normalized = next
  }
  return normalized || original
}

export function getControlCommentDedupeKey(comment: ExtractedControlComment) {
  return [normalizeControlNickname(comment.nick_name), normalizeText(comment.content ?? '')].join(
    '\u0001',
  )
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

export function extractCompassLiveRoomId(payload: unknown): string | undefined {
  const visit = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item)
        if (found) return found
      }
      return undefined
    }
    if (!isRecord(value)) return undefined

    const roomId = readString(value, ['room_id', 'roomId', 'live_room_id', 'liveRoomId'])
    if (roomId) return roomId

    for (const child of Object.values(value)) {
      const found = visit(child)
      if (found) return found
    }
    return undefined
  }

  return visit(payload)
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
  private domPollTimer: NodeJS.Timeout | null = null
  private seenCommentKeys = new Map<string, number>()
  private lastCommentAt = 0
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
    }, CONTROL_KEEP_ALIVE_MS)
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
    void this.scanVisibleComments().finally(() => this.scheduleDomPolling())
  }

  private scheduleDomPolling() {
    if (!this.isRunning) return
    const recentlyEmittedComment =
      this.lastCommentAt > 0 &&
      Date.now() - this.lastCommentAt < CONTROL_DOM_RECENT_COMMENT_WINDOW_MS
    const intervalMs = recentlyEmittedComment
      ? CONTROL_DOM_POLL_ACTIVE_MS
      : CONTROL_DOM_POLL_IDLE_MS
    this.domPollTimer = setTimeout(async () => {
      this.domPollTimer = null
      await this.scanVisibleComments()
      this.scheduleDomPolling()
    }, intervalMs)
  }

  private stopDomPolling() {
    if (this.domPollTimer) {
      clearTimeout(this.domPollTimer)
      this.domPollTimer = null
    }
  }

  private pruneSeenCommentKeys(now: number) {
    for (const [key, seenAt] of this.seenCommentKeys) {
      if (now - seenAt > CONTROL_DOM_RECENT_COMMENT_WINDOW_MS) {
        this.seenCommentKeys.delete(key)
      }
    }
    if (this.seenCommentKeys.size <= 1000) return
    const overflow = this.seenCommentKeys.size - 500
    let removed = 0
    for (const key of this.seenCommentKeys.keys()) {
      this.seenCommentKeys.delete(key)
      removed += 1
      if (removed >= overflow) break
    }
  }

  private emitComment(comment: ExtractedControlComment) {
    const content = comment.content?.trim()
    if (!content) return false

    const now = Date.now()
    this.pruneSeenCommentKeys(now)
    const key = getControlCommentDedupeKey(comment)
    if (this.seenCommentKeys.has(key)) return false
    this.seenCommentKeys.set(key, now)
    this.lastCommentAt = now

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
    if (!this.isRunning || this.page.isClosed()) return 0

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

      let emittedCount = 0
      for (const text of items) {
        const comment = parseControlDomCommentText(text)
        if (comment && this.emitComment(comment)) emittedCount += 1
      }
      return emittedCount
    } catch {
      // 页面切换和直播组件刷新时可能短暂不可读，下一轮继续扫描。
    }
    return 0
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
    } | null
  }
}

interface LiveOrderResponse {
  data:
    | {
        item_num: number
        nick_name: string
        order_id: string
        order_status: number // 已知： 3 -> 已支付          0 -> 已下单
        order_ts: number
        product_id: string
        product_title: string
      }[]
    | null
  msg: string
}

export function extractCompassMessagesFromResponse(data: CompassMessageResponse) {
  const comments: DouyinLiveMessage[] = []
  const messageGroups = data?.data?.messages
  if (messageGroups) {
    for (const messages of Object.values(messageGroups)) {
      if (!Array.isArray(messages)) continue
      for (const message of messages) {
        comments.push({ ...message, time: new Date().toLocaleTimeString() })
      }
    }
  }

  for (const comment of extractControlCommentsFromPayload(data)) {
    const content = normalizeText(comment.content ?? '')
    if (!content) continue
    comments.push({
      msg_type: 'comment',
      msg_id: comment.msg_id ?? getControlCommentDedupeKey(comment),
      nick_name: normalizeControlNickname(comment.nick_name),
      content,
      time: new Date().toLocaleTimeString(),
    })
  }

  const seen = new Set<string>()
  return comments.filter(comment => {
    const key = [
      comment.msg_type,
      comment.msg_id,
      comment.nick_name,
      'content' in comment ? comment.content : '',
    ].join('\u0001')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractLiveOrderMessagesFromResponse(data: LiveOrderResponse) {
  if (!Array.isArray(data?.data)) {
    return []
  }

  return data.data.map(item => {
    let order_status: LiveOrderMessage['order_status'] = '未知状态'
    // TODO: 不确定已下单对应的是多少！
    if (item.order_status <= 1) {
      order_status = '已下单'
    } else if (item.order_status === 3) {
      order_status = '已付款'
    }
    return {
      msg_type: 'live_order' as const,
      msg_id: `${item.order_id}#${item.order_status}`,
      nick_name: item.nick_name,
      order_status,
      order_ts: item.order_ts,
      product_id: item.product_id,
      product_title: item.product_title,
      time: new Date().toLocaleTimeString(),
    }
  })
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
    const getLiveRoomId = async () => {
      return new Promise<string>((resolve, reject) => {
        const page = this.page
        let reloadTimer: NodeJS.Timeout | null = null
        let timeoutTimer: NodeJS.Timeout | null = null
        let settled = false
        let handleResponse: (response: Response) => Promise<void>
        const cleanup = () => {
          page.off('response', handleResponse)
          if (reloadTimer) clearTimeout(reloadTimer)
          if (timeoutTimer) clearTimeout(timeoutTimer)
        }
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          cleanup()
          fn()
        }
        handleResponse = async (response: Response) => {
          const url = response.url()
          if (url.includes('promotions_v2?')) {
            const resData = await response.json()
            const roomId = extractCompassLiveRoomId(resData)
            if (roomId) {
              // this.logger.debug(`获取直播间 ID成功: ${roomId}`)
              settle(() => resolve(roomId))
            }
          }
        }
        page.on('response', handleResponse)

        reloadTimer = setTimeout(() => {
          if (settled || page.isClosed()) return
          void page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {
            // 只用刷新触发直播间信息接口；刷新失败时仍等待原超时处理。
          })
        }, 800)

        timeoutTimer = setTimeout(() => {
          settle(() => reject(new Error('找不到直播间 ID，可能直播间已关闭')))
        }, 15_000)
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
    for (const comment of extractCompassMessagesFromResponse(data)) {
      this.handleComment(comment)
    }
  }

  private handleLiveOrderResponse(data: LiveOrderResponse) {
    for (const comment of extractLiveOrderMessagesFromResponse(data)) {
      this.handleComment(comment)
    }
  }

  async startCommentListener(onComment: (comment: DouyinLiveMessage) => void) {
    this.handleComment = onComment
    await this.connectCompass()
    this.listenResponse()
  }

  async stopCommentListener() {
    this.compassPage?.removeAllListeners('response')
    await this.compassPage?.close().catch(() => {
      // 页面可能已随上下文一起关闭；停止监听时忽略这类关闭竞态。
    })
    // 优化：关闭后置空，避免内存泄漏
    this.compassPage = undefined
  }

  getCommentListenerPage(): Page {
    return this.compassPage ?? this.page
  }
}
