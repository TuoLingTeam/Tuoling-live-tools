import type { Result } from '@praha/byethrow'
import type { Page, Request, Response } from 'playwright'
import type { PlatformError } from '#/errors/PlatformError'
import type { ScopedLogger } from '#/logger'
import {
  type BrowserSession,
  browserManager,
  type StorageState,
} from '#/managers/BrowserSessionManager'
import { comment } from '../helper'
import {
  CompassListener,
  extractCompassLiveRoomId,
  extractCompassMessagesFromResponse,
  extractLiveOrderMessagesFromResponse,
} from './commentListener'
import { SELECTORS, URLS } from './constant'
import { douyinElementFinder as elementFinder } from './element-finder'

type BrowserlessPlatformId = 'douyin' | 'buyin'

type CapturedRequest = {
  url: string
  method: string
  headers: Record<string, string>
  postData?: string | null
}

type BrowserlessDiscovery = {
  liveRoomId?: string
  messageRequest?: CapturedRequest
  orderRequest?: CapturedRequest
}

const DISCOVERY_TIMEOUT_MS = 18_000
const POLL_INTERVAL_MS = 2_000
const ORDER_POLL_INTERVAL_MS = 5_000
const SEND_SESSION_IDLE_MS = 30_000
const REDISCOVER_AFTER_ERRORS = 5
const FALLBACK_AFTER_EMPTY_POLLS = 3
const PROBE_COMMENTS = ['111', '222', '333']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function storageCookieHeader(storageState: StorageState | undefined) {
  if (!storageState || !isRecord(storageState) || !Array.isArray(storageState.cookies)) {
    return ''
  }
  return storageState.cookies
    .filter(cookie => isRecord(cookie) && typeof cookie.name === 'string')
    .map(cookie => {
      const name = String(cookie.name)
      const value = String(cookie.value ?? '')
      return `${name}=${value}`
    })
    .join('; ')
}

function sanitizeHeaders(headers: Record<string, string>, cookieHeader: string) {
  const next: Record<string, string> = {}
  const blocked = new Set(['accept-encoding', 'connection', 'content-length', 'cookie', 'host'])

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower.startsWith(':') || blocked.has(lower)) continue
    next[key] = value
  }

  if (cookieHeader) {
    next.cookie = cookieHeader
  }
  return next
}

async function serializeRequest(request: Request, cookieHeader: string): Promise<CapturedRequest> {
  return {
    url: request.url(),
    method: request.method(),
    headers: sanitizeHeaders(request.headers(), cookieHeader),
    postData: request.postData(),
  }
}

function isKnownOfflineResponse(status: number, bodyText: string) {
  if (status === 404 || status === 410) return true
  return /直播.*(结束|关闭|不存在)|room.*(closed|ended|not_found)/i.test(bodyText)
}

function getMessageKey(message: LiveMessage) {
  return [
    message.msg_type,
    message.msg_id,
    message.nick_name ?? '',
    'content' in message ? message.content : '',
  ].join('\u0001')
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function summarizePayloadShape(value: unknown) {
  if (!isRecord(value)) {
    return { type: Array.isArray(value) ? 'array' : typeof value }
  }

  const data = isRecord(value.data) ? value.data : null
  const messages = data && isRecord(data.messages) ? data.messages : null
  return {
    topKeys: Object.keys(value).slice(0, 12),
    dataKeys: data ? Object.keys(data).slice(0, 16) : [],
    messageKeys: messages ? Object.keys(messages).slice(0, 16) : [],
  }
}

function summarizeMessages(messages: LiveMessage[]) {
  return messages.slice(0, 3).map(message => ({
    type: message.msg_type,
    id: message.msg_id,
    nick: message.nick_name,
    content: 'content' in message ? String(message.content ?? '').slice(0, 40) : '',
  }))
}

async function fetchCapturedJson(request: CapturedRequest, signal?: AbortSignal) {
  const method = request.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.postData
  const response = await fetch(request.url, {
    method,
    headers: request.headers,
    body: hasBody ? request.postData : undefined,
    signal,
  })
  const text = await response.text()
  if (!response.ok) {
    const error = new Error(`browserless fetch failed: ${response.status}`)
    ;(error as Error & { status?: number; bodyText?: string }).status = response.status
    ;(error as Error & { status?: number; bodyText?: string }).bodyText = text
    throw error
  }
  return text ? JSON.parse(text) : null
}

function formatBrowserlessError(error: unknown) {
  if (error instanceof Error) {
    const detail = error as Error & { status?: number; bodyText?: string }
    return {
      name: error.name,
      message: error.message,
      status: detail.status,
      body: detail.bodyText?.slice(0, 300),
    }
  }
  return { message: String(error) }
}

export class BrowserlessDouyinRuntime {
  private accountId = ''
  private storageState: StorageState | undefined
  private cookieHeader = ''
  private discovery: BrowserlessDiscovery = {}
  private discoveryAttempted = false
  private running = false
  private pollTimer: NodeJS.Timeout | null = null
  private sendSession: BrowserSession | null = null
  private sendIdleTimer: NodeJS.Timeout | null = null
  private seenMessageKeys = new Map<string, number>()
  private consecutiveFetchErrors = 0
  private consecutiveEmptyPolls = 0
  private lastOrderPollAt = 0
  private pollDebugCounter = 0
  private fallbackSession: BrowserSession | null = null
  private fallbackListener: CompassListener | null = null
  private fallbackStarting: Promise<void> | null = null
  private onComment: (comment: LiveMessage) => void = () => {}

  constructor(
    private readonly platform: BrowserlessPlatformId,
    private readonly logger: ScopedLogger,
    private readonly connectControlSession: (session: BrowserSession) => Promise<boolean>,
  ) {}

  async hydrate(params: {
    accountId: string
    storageState: StorageState
    browserSession?: BrowserSession | null
  }) {
    this.accountId = params.accountId
    this.storageState = params.storageState
    this.cookieHeader = storageCookieHeader(params.storageState)

    if (!this.cookieHeader) {
      this.logger.warn('[browserless] storageState 中没有可用 Cookie，保持浏览器兜底模式')
      return false
    }

    if (!params.browserSession) {
      this.logger.warn('[browserless] 没有可用于发现罗盘接口的浏览器会话，保持浏览器兜底模式')
      return false
    }

    try {
      await this.discoverFromSession(params.browserSession)
    } catch (error) {
      this.discovery = {}
      this.discoveryAttempted = true
      this.logger.warn(
        `[browserless][${this.accountId}] 初次发现罗盘接口失败，保持浏览器兜底模式：`,
        formatBrowserlessError(error),
      )
      return false
    }

    if (!this.hasLiveProbeRequest()) {
      this.logger.warn(
        `[browserless][${this.accountId}] 未发现可用于直播检测的罗盘接口，保持浏览器兜底模式`,
      )
      return false
    }

    return true
  }

  private hasLiveProbeRequest() {
    return !!(this.discovery.messageRequest || this.discovery.orderRequest)
  }

  hasRuntime() {
    return !!this.storageState && !!this.cookieHeader && this.hasLiveProbeRequest()
  }

  canStartTaskWithoutBrowser(taskType: LiveControlTask['type']) {
    return (
      this.hasRuntime() &&
      ['comment-listener', 'auto-comment', 'send-batch-messages'].includes(taskType)
    )
  }

  async isLiveWithoutBrowser() {
    if (!this.storageState || !this.cookieHeader) {
      throw new Error('browserless runtime is not hydrated')
    }

    await this.ensureDiscovery(false)
    const request = this.discovery.messageRequest ?? this.discovery.orderRequest
    if (!request) {
      this.logger.debug(`[browserless][${this.accountId}] 没有可用罗盘请求，直播状态保持未知`)
      return 'unknown' as const
    }

    try {
      await fetchCapturedJson(request)
      return true
    } catch (error) {
      const detail = error as Error & { status?: number; bodyText?: string }
      if (detail.status && isKnownOfflineResponse(detail.status, detail.bodyText ?? '')) {
        return false
      }
      throw error
    }
  }

  async startCommentListener(onComment: (comment: LiveMessage) => void) {
    if (this.running) {
      this.onComment = onComment
      return
    }

    this.onComment = onComment
    this.running = true
    await this.ensureDiscovery(true)
    this.schedulePoll(0)
    this.logger.info(`[browserless][${this.accountId}] 评论监听已切换到轻量 HTTP 轮询`)
  }

  async stopCommentListener() {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    await this.stopFallbackListener()
  }

  async performComment(message: string, pinTop: boolean) {
    return (await this.withControlPage(page =>
      comment(page, elementFinder, message, pinTop),
    )) as Result.Result<boolean, PlatformError>
  }

  async close() {
    await this.stopCommentListener()
    await this.closeSendSession()
  }

  private async ensureDiscovery(allowTransientDiscovery = true) {
    if (this.discovery.messageRequest || this.discovery.orderRequest) {
      return
    }
    if (!allowTransientDiscovery && this.discoveryAttempted) {
      return
    }
    await this.discoverWithTransientSession()
  }

  private schedulePoll(delayMs: number) {
    if (!this.running) return
    if (this.fallbackListener || this.fallbackStarting) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      void this.pollOnce()
        .catch(error =>
          this.logger.warn(
            `[browserless][${this.accountId}] 评论轮询失败：`,
            formatBrowserlessError(error),
          ),
        )
        .finally(() => this.schedulePoll(POLL_INTERVAL_MS))
    }, delayMs)
  }

  private async pollOnce() {
    if (!this.running) return
    if (this.fallbackListener || this.fallbackStarting) return

    try {
      const comments: LiveMessage[] = []
      if (this.discovery.messageRequest) {
        const data = await fetchCapturedJson(this.discovery.messageRequest)
        const messageComments = extractCompassMessagesFromResponse(data)
        comments.push(...messageComments)
        this.logPollDiagnostic('message', data, messageComments)
      }

      const shouldPollOrder = Date.now() - this.lastOrderPollAt >= ORDER_POLL_INTERVAL_MS
      if (shouldPollOrder && this.discovery.orderRequest) {
        this.lastOrderPollAt = Date.now()
        const data = await fetchCapturedJson(this.discovery.orderRequest)
        const orderMessages = extractLiveOrderMessagesFromResponse(data)
        comments.push(...orderMessages)
        this.logPollDiagnostic('order', data, orderMessages)
      }

      this.consecutiveFetchErrors = 0
      this.emitNewMessages(comments)
      if (comments.length > 0) {
        this.consecutiveEmptyPolls = 0
      } else {
        this.consecutiveEmptyPolls += 1
        if (this.consecutiveEmptyPolls >= FALLBACK_AFTER_EMPTY_POLLS) {
          await this.startFallbackCompassListener()
        }
      }
    } catch (error) {
      this.consecutiveFetchErrors += 1
      if (this.consecutiveFetchErrors >= REDISCOVER_AFTER_ERRORS) {
        this.consecutiveFetchErrors = 0
        await this.discoverWithTransientSession().catch(discoverError => {
          this.logger.warn(
            `[browserless][${this.accountId}] 重新发现罗盘接口失败：`,
            formatBrowserlessError(discoverError),
          )
        })
      }
      throw error
    }
  }

  private logPollDiagnostic(
    source: 'message' | 'order',
    payload: unknown,
    messages: LiveMessage[],
  ) {
    this.pollDebugCounter += 1
    const rawText = safeStringify(payload)
    const matchedProbe = PROBE_COMMENTS.find(probe => rawText.includes(probe))
    const containsProbeComment = Boolean(matchedProbe)
    const shouldLog = containsProbeComment || messages.length > 0 || this.pollDebugCounter <= 3
    if (!shouldLog) return

    this.logger.info(`[browserless][${this.accountId}] 评论轮询诊断`, {
      source,
      parsedCount: messages.length,
      matchedProbe,
      shape: summarizePayloadShape(payload),
      samples: summarizeMessages(messages),
    })
  }

  private async startFallbackCompassListener() {
    if (this.fallbackListener || this.fallbackStarting) return this.fallbackStarting
    if (!this.storageState) {
      throw new Error('browserless runtime storageState is missing')
    }

    this.fallbackStarting = (async () => {
      this.logger.warn(
        `[browserless][${this.accountId}] 轻量 HTTP 轮询连续空数据，降级到短生命周期无头罗盘监听`,
      )
      const session = await browserManager.createSession(true, this.storageState)
      let listener: CompassListener | null = null
      try {
        const connected = await this.connectControlSession(session)
        if (!connected) {
          throw new Error('无法通过保存的登录态连接中控台')
        }
        listener = new CompassListener(this.platform, session.page)
        await listener.startCommentListener(message => {
          if (message.msg_type !== 'comment') {
            return
          }
          this.consecutiveEmptyPolls = 0
          this.logger.info(`[browserless][${this.accountId}] 无头罗盘评论已派发`, {
            samples: summarizeMessages([message]),
          })
          this.onComment(message)
        })
        this.fallbackSession = session
        this.fallbackListener = listener
        this.logger.info(`[browserless][${this.accountId}] 已启用短生命周期无头罗盘监听`)
        if (this.pollTimer) {
          clearTimeout(this.pollTimer)
          this.pollTimer = null
        }
      } catch (error) {
        await listener?.stopCommentListener().catch(() => {})
        await this.closeSession(session)
        throw error
      }
    })()

    try {
      await this.fallbackStarting
    } finally {
      this.fallbackStarting = null
    }
  }

  private async stopFallbackListener() {
    const starting = this.fallbackStarting
    this.fallbackStarting = null
    if (starting) {
      await starting.catch(error => {
        this.logger.warn(
          `[browserless][${this.accountId}] 等待无头罗盘监听启动结束失败：`,
          formatBrowserlessError(error),
        )
      })
    }

    const listener = this.fallbackListener
    const session = this.fallbackSession
    this.fallbackListener = null
    this.fallbackSession = null
    this.consecutiveEmptyPolls = 0

    await listener?.stopCommentListener().catch(error => {
      this.logger.warn(
        `[browserless][${this.accountId}] 关闭无头罗盘监听失败：`,
        formatBrowserlessError(error),
      )
    })
    if (session) {
      await this.closeSession(session)
    }
  }

  private emitNewMessages(messages: LiveMessage[]) {
    const now = Date.now()
    for (const [key, seenAt] of this.seenMessageKeys) {
      if (now - seenAt > 60_000) this.seenMessageKeys.delete(key)
    }

    let emittedCount = 0
    const emittedSamples: LiveMessage[] = []
    for (const message of messages) {
      const key = getMessageKey(message)
      if (this.seenMessageKeys.has(key)) continue
      this.seenMessageKeys.set(key, now)
      emittedCount += 1
      if (emittedSamples.length < 3) {
        emittedSamples.push(message)
      }
      this.onComment(message)
    }

    if (emittedCount > 0) {
      this.logger.info(`[browserless][${this.accountId}] 评论已派发`, {
        emittedCount,
        samples: summarizeMessages(emittedSamples),
      })
    }
  }

  private async discoverWithTransientSession() {
    if (!this.storageState) {
      throw new Error('browserless runtime storageState is missing')
    }

    const session = await browserManager.createSession(true, this.storageState)
    try {
      const connected = await this.connectControlSession(session)
      if (!connected) {
        throw new Error('无法通过保存的登录态连接中控台')
      }
      await this.discoverFromSession(session)
    } finally {
      await this.closeSession(session)
    }
  }

  private async discoverFromSession(session: BrowserSession) {
    const liveRoomId = await this.discoverLiveRoomId(session.page)
    const captured = await this.captureCompassRequests(session.page, liveRoomId)
    this.discoveryAttempted = true
    this.discovery = {
      liveRoomId,
      ...captured,
    }
    this.logger.info(`[browserless][${this.accountId}] 罗盘接口发现完成`, {
      liveRoomId,
      hasMessageRequest: !!captured.messageRequest,
      hasOrderRequest: !!captured.orderRequest,
    })
  }

  private async discoverLiveRoomId(page: Page) {
    return await new Promise<string>((resolve, reject) => {
      let reloadTimer: NodeJS.Timeout | null = null
      let timeoutTimer: NodeJS.Timeout | null = null
      let settled = false

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
      const handleResponse = async (response: Response) => {
        if (!response.url().includes('promotions_v2?')) return
        try {
          const roomId = extractCompassLiveRoomId(await response.json())
          if (roomId) settle(() => resolve(roomId))
        } catch {
          // Ignore malformed platform responses and wait for the next one.
        }
      }

      page.on('response', handleResponse)
      reloadTimer = setTimeout(() => {
        if (!settled && !page.isClosed()) {
          void page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
        }
      }, 800)
      timeoutTimer = setTimeout(() => {
        settle(() => reject(new Error('找不到直播间 ID，可能直播间已关闭')))
      }, 15_000)
    })
  }

  private async captureCompassRequests(page: Page, liveRoomId: string) {
    const context = page.context()
    const compassPage = await context.newPage()
    const captured: Pick<BrowserlessDiscovery, 'messageRequest' | 'orderRequest'> = {}

    const handleResponse = async (response: Response) => {
      const url = response.url()
      const request = response.request()
      if (url.includes('message?') && !captured.messageRequest) {
        captured.messageRequest = await serializeRequest(request, this.cookieHeader)
      } else if (url.includes('live_order_stream?') && !captured.orderRequest) {
        captured.orderRequest = await serializeRequest(request, this.cookieHeader)
      }
    }

    compassPage.on('response', handleResponse)
    try {
      await compassPage.goto(
        this.platform === 'douyin'
          ? URLS.DOUYIN_COMPASS_INDEX_PREFIX
          : URLS.BUYIN_COMPASS_INDEX_PREFIX,
        { waitUntil: 'domcontentloaded', timeout: 15_000 },
      )
      await compassPage.waitForSelector(SELECTORS.COMPASS_LOGGED_IN, { timeout: 15_000 })
      await compassPage.goto(
        `${
          this.platform === 'douyin'
            ? URLS.DOUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
            : URLS.BUYIN_COMPASS_SCREEN_WITH_LIVE_ROOM_ID
        }${liveRoomId}`,
        { waitUntil: 'domcontentloaded', timeout: 15_000 },
      )
      await this.waitForCapturedRequest(captured)
    } finally {
      compassPage.off('response', handleResponse)
      await compassPage.close().catch(() => {})
    }

    return captured
  }

  private async waitForCapturedRequest(
    captured: Pick<BrowserlessDiscovery, 'messageRequest' | 'orderRequest'>,
  ) {
    const startedAt = Date.now()
    while (!captured.messageRequest && Date.now() - startedAt < DISCOVERY_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (!captured.messageRequest && !captured.orderRequest) {
      throw new Error('未捕获到罗盘评论接口请求')
    }
  }

  private async withControlPage<T>(
    task: (page: Page) => Promise<Result.Result<T, PlatformError>>,
  ): Promise<Result.Result<T, PlatformError>> {
    const session = await this.getOrCreateSendSession()
    try {
      const result = await task(session.page)
      this.scheduleSendSessionClose()
      return result
    } catch (error) {
      await this.closeSendSession()
      throw error
    }
  }

  private async getOrCreateSendSession() {
    if (this.sendSession?.browser.isConnected() && !this.sendSession.page.isClosed()) {
      this.clearSendIdleTimer()
      return this.sendSession
    }

    if (!this.storageState) {
      throw new Error('browserless runtime storageState is missing')
    }

    this.sendSession = await browserManager.createSession(true, this.storageState)
    const connected = await this.connectControlSession(this.sendSession)
    if (!connected) {
      await this.closeSendSession()
      throw new Error('无法打开发送评论所需的短生命周期中控台页面')
    }
    return this.sendSession
  }

  private scheduleSendSessionClose() {
    this.clearSendIdleTimer()
    this.sendIdleTimer = setTimeout(() => {
      void this.closeSendSession().catch(error => {
        this.logger.warn(
          `[browserless][${this.accountId}] 关闭发送兜底页面失败：`,
          formatBrowserlessError(error),
        )
      })
    }, SEND_SESSION_IDLE_MS)
  }

  private clearSendIdleTimer() {
    if (this.sendIdleTimer) {
      clearTimeout(this.sendIdleTimer)
      this.sendIdleTimer = null
    }
  }

  private async closeSendSession() {
    this.clearSendIdleTimer()
    const session = this.sendSession
    this.sendSession = null
    if (session) {
      await this.closeSession(session)
    }
  }

  private async closeSession(session: BrowserSession) {
    await session.page.close().catch(() => {})
    await session.context.close().catch(() => {})
    await browserManager.releaseSessionBrowser(session)
  }
}
