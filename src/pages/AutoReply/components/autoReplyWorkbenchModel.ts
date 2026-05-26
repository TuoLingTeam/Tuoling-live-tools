import type { Message, ReplyPreview } from '@/hooks/autoReplyTypes'
import {
  getAutoReplyDisplayName,
  isAutoReplyHostNickname,
  normalizeAutoReplyNickname,
} from '@/lib/autoReplyIdentity'

export { getAutoReplyDisplayName } from '@/lib/autoReplyIdentity'

const COMMENT_TYPES = new Set<Message['msg_type']>([
  'comment',
  'wechat_channel_live_msg',
  'xiaohongshu_comment',
  'taobao_comment',
])

export type WorkbenchConversationMessage = {
  id: string
  role: 'viewer' | 'operator'
  author: string
  content: string
  at?: string
  timeLabel: string
  sortTime: number
  order: number
  commentId?: string
  replyId?: string
  replyKind?: ReplyPreview['source']
  sourceLabel?: string
  isCurrentComment?: boolean
}

export type WorkbenchTask = {
  comment: Message
  reply?: ReplyPreview
}

export type AutoReplyOperatorName = string | string[] | null | undefined

export type ScopedWorkbenchSource = {
  accountId: string
  accountName: string
  platformLabel: string
  operatorName?: AutoReplyOperatorName
  comments: Message[]
  replies: ReplyPreview[]
}

export type ScopedWorkbenchTask = WorkbenchTask & {
  accountId: string
  accountName: string
  platformLabel: string
  operatorName?: AutoReplyOperatorName
  taskKey: string
  sortTime: number
}

export type AutoReplyKnowledgeRule = {
  keywords: string[]
  contents: string[]
}

export type AutoReplyWorkbenchTaskStatus = 'sent' | 'ignored' | 'configured' | 'unconfigured'

export type AutoReplyWorkbenchTaskState = {
  status: AutoReplyWorkbenchTaskStatus
  isSent: boolean
  isIgnored: boolean
  isConfigured: boolean
  isUnconfigured: boolean
}

export type AutoReplyWorkbenchKeywordConfig = {
  comment: {
    keywordReply: {
      enable: boolean
      rules: AutoReplyKnowledgeRule[]
    }
  }
}

export type AutoReplyKeywordReplyMatch = {
  keyword: string
  content: string
  rule: AutoReplyKnowledgeRule
}

const AUTO_REPLY_SAVED_KEYWORD_LIMIT = 24
const AUTO_REPLY_SAVED_CONTENT_LIMIT = 12
export const AUTO_REPLY_WORKBENCH_IGNORE_AFTER_MS = 60 * 1000

const DUPLICATE_CONTEXT_COMMENT_WINDOW_MS = 5000
const HISTORY_CONFIG_INTENT_PATTERN =
  /(多少钱|价格|优惠|活动|几|多少|多久|保质|日期|发货|快递|包邮|库存|还有|现货|规格|尺寸|颜色|链接|拍|下单|怎么|如何|能不能|可以|是不是|真假|正品|产地|售后|退换)/u
const HISTORY_ORDER_CONFIRMATION_PATTERN =
  /(下单了|已下单|已经下单|刚下单|下了一单|拍了|已拍|已经拍|刚拍|拍下了|已拍下|拍了一单|买了|已买|购买了|付款了|已付款|付过款)/u
const HISTORY_ORDER_CONFIRMATION_KEYWORDS = ['下单了', '已下单', '拍了', '已拍']
const PLATFORM_EMOJI_CODE_PATTERN =
  /\[(?:赞|爱心|比心|玫瑰|鼓掌|感谢|谢谢|抱拳|加油|握手|强|弱|笑哭|捂脸|大笑|偷笑|呲牙|色|惊讶|流泪|哭|发怒|调皮|害羞|亲亲|OK|666|礼物|红包|烟花|蛋糕|咖啡|太阳|月亮|星星|火)\]/giu
const DECIMAL_POINT_TOKEN = 'DECIMALDOT'

function getAutoReplyOperatorDisplayName(operatorName: AutoReplyOperatorName) {
  const names = Array.isArray(operatorName) ? operatorName : [operatorName]
  return names.find(name => name?.trim())?.trim() || '主播'
}

export function getAutoReplyWorkbenchTaskKey(accountId: string, commentId: string) {
  return `${accountId}:${commentId}`
}

export function isAutoReplyTextComment(message: Message) {
  return COMMENT_TYPES.has(message.msg_type)
}

export function isAutoReplyViewerComment(message: Message, operatorName?: AutoReplyOperatorName) {
  if (!isAutoReplyTextComment(message)) return false

  return !isAutoReplyHostNickname(message.nick_name, operatorName)
}

export function getAutoReplyMessageLabel(message: Message) {
  switch (message.msg_type) {
    case 'room_enter':
      return '进房'
    case 'room_like':
      return '点赞'
    case 'room_follow':
      return '关注'
    case 'subscribe_merchant_brand_vip':
      return '会员'
    case 'live_order':
      return '下单'
    case 'ecom_fansclub_participate':
      return '粉丝团'
    default:
      return '评论'
  }
}

function getNicknameContinuationRepair(message: Message) {
  if (!('content' in message) || typeof message.content !== 'string') {
    return null
  }

  const compactName = (message.nick_name || '').trim().replace(/\s+/g, '')
  const content = message.content.trim()
  const minuteMatch = content.match(/^([0-5]\d)\):\s*(.+)$/u)
  if (!compactName || !minuteMatch) {
    return null
  }

  const lastOpenIndex = compactName.lastIndexOf('(')
  const lastCloseIndex = compactName.lastIndexOf(')')
  if (lastOpenIndex < 0 || lastCloseIndex > lastOpenIndex) {
    return null
  }

  const hourMatch = compactName.match(/^(.*?)([01]?\d|2[0-3])$/u)
  if (!hourMatch) {
    return null
  }

  return {
    nickName: `${hourMatch[1]}${hourMatch[2]}:${minuteMatch[1]})`,
    content: minuteMatch[2].trim(),
  }
}

export function getAutoReplyMessageDisplayName(message: Message) {
  return getAutoReplyDisplayName(
    getNicknameContinuationRepair(message)?.nickName ?? message.nick_name,
  )
}

export function getAutoReplyMessageDetail(message: Message) {
  const repaired = getNicknameContinuationRepair(message)
  if (repaired) {
    return repaired.content
  }

  if ('content' in message && typeof message.content === 'string') {
    return message.content
  }
  if (message.msg_type === 'live_order') {
    return message.product_title || '用户下单'
  }
  return getAutoReplyMessageLabel(message)
}

export function getAutoReplyReplySourceLabel(reply: Pick<ReplyPreview, 'source'>) {
  if (reply.source === 'product-kb') return '商品知识'
  if (reply.source === 'manual') return '人工回复'
  return 'AI建议'
}

function getConversationReplySourceLabel(reply: Pick<ReplyPreview, 'source'>) {
  if (reply.source === 'product-kb') return '知识库回复'
  if (reply.source === 'manual') return '人工回复'
  return 'AI回复'
}

function normalizeKnowledgeText(text: string) {
  return text.trim().replace(/\s+/g, '')
}

function uniqueTextList(values: string[], limit = 6) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    const key = normalizeKnowledgeText(normalized)
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= limit) break
  }

  return result
}

function cleanQuestionSegment(segment: string) {
  return stripPlatformEmojiCodes(segment)
    .trim()
    .replace(/^(主播|请问|问一下|想问下|想问一下|麻烦问下|老师|亲)[，,\s]*/u, '')
    .replace(/[？?。.!！~～]+$/u, '')
    .trim()
}

function stripPlatformEmojiCodes(text: string) {
  return text.replace(PLATFORM_EMOJI_CODE_PATTERN, '')
}

function protectDecimalPoints(text: string) {
  return text.replace(/(\d)\.(\d)/gu, `$1${DECIMAL_POINT_TOKEN}$2`)
}

function restoreDecimalPoints(text: string) {
  return text.replaceAll(DECIMAL_POINT_TOKEN, '.')
}

export function splitAutoReplyKnowledgeQuestion(question: string) {
  const normalized = question.trim()
  if (!normalized) return []
  const protectedQuestion = protectDecimalPoints(normalized)

  const segments = protectedQuestion
    .split(/[？?。.!！；;，,\n]+/u)
    .map(restoreDecimalPoints)
    .map(cleanQuestionSegment)
    .filter(segment => segment.length > 0)

  return uniqueTextList(segments.length ? segments : [cleanQuestionSegment(normalized)], 4)
}

function extractSlotKeywords(question: string) {
  const keywords: string[] = []
  for (const match of question.matchAll(/([0-9]{1,2})\s*号\s*(?:链接|商品|款)?/gu)) {
    if (match[1]) {
      keywords.push(`${Number.parseInt(match[1], 10)}号链接`)
    }
  }
  return keywords
}

function toKeywordCandidate(segment: string) {
  return restoreDecimalPoints(
    protectDecimalPoints(stripPlatformEmojiCodes(segment))
      .replace(/^(主播|请问|问一下|想问下|想问一下|麻烦问下|老师|亲)[，,\s]*/u, '')
      .replace(/(什么时候|啥时候|多久|怎么|如何|可以|能不能|是不是|还有吗|吗|呢|呀|啊|哦|吧)/gu, '')
      .replace(/[^\p{Script=Han}0-9A-Za-z]+/gu, '')
      .trim(),
  )
}

function extractPurchaseSpecKeywords(question: string) {
  const cleanedQuestion = cleanQuestionSegment(question)
  const priceSpecMatch = cleanedQuestion.match(
    /(\d+(?:\.\d+)?)\s*(?:元|块|块钱)?\s*(?:的|是)?\s*(几|多少)\s*([一-龥]{0,2}(?:盒|瓶|斤|个|袋|罐|件|支|包|份|套|箱))/u,
  )
  if (!priceSpecMatch) return []

  const actionMatch = cleanedQuestion.match(
    /(我)?\s*(拍了|拍下了|拍下|已拍|下单了|已下单|买了|购买了)/u,
  )
  const actionKeyword = actionMatch
    ? `${actionMatch[1] ?? ''}${actionMatch[2]}`.replace(/\s+/gu, '')
    : ''
  const priceKeyword = `${priceSpecMatch[1]}是${priceSpecMatch[2]}${priceSpecMatch[3]}`

  return uniqueTextList([actionKeyword, priceKeyword], 3)
}

function isPriceSpecKeyword(keyword: string) {
  return /\d+(?:\.\d+)?(?:元|块|块钱)?(?:的|是)?(?:几|多少)[\p{Script=Han}]*/u.test(keyword)
}

export function buildAutoReplyKnowledgeBasis(question: string) {
  const questionSegments = splitAutoReplyKnowledgeQuestion(question)
  const segmentKeywords = questionSegments
    .map(toKeywordCandidate)
    .filter(keyword => keyword.length >= 2 && keyword.length <= 10)
  const fallbackKeyword = cleanQuestionSegment(question).slice(0, 10)
  const purchaseSpecKeywords = extractPurchaseSpecKeywords(question)
  const scopedSegmentKeywords = purchaseSpecKeywords.length
    ? segmentKeywords.filter(keyword => !isPriceSpecKeyword(keyword))
    : segmentKeywords
  const keywordCandidates = [
    ...extractSlotKeywords(question),
    ...purchaseSpecKeywords,
    ...scopedSegmentKeywords,
  ]

  return {
    questionSegments,
    keywords: uniqueTextList(keywordCandidates.length ? keywordCandidates : [fallbackKeyword], 5),
  }
}

export function normalizeAutoReplyHistoryQuestionKey(question: string) {
  return cleanQuestionSegment(question)
    .replace(/[^\p{Script=Han}0-9A-Za-z]+/gu, '')
    .toLowerCase()
}

function getHistorySlotScope(questionKey: string) {
  const slotMatch = questionKey.match(/(?:^|[^0-9])([0-9]{1,2})(?:号|链接|商品|款)/u)
  return slotMatch?.[1] ? `slot:${Number.parseInt(slotMatch[1], 10)}:` : ''
}

export function getAutoReplyHistorySemanticGroupKey(question: string) {
  const questionKey = normalizeAutoReplyHistoryQuestionKey(question)
  if (!questionKey) return ''

  const slotScope = getHistorySlotScope(questionKey)
  if (/(发货|快递|几天到|多久到|哪里发|哪发|包邮|运费)/u.test(questionKey)) {
    return `${slotScope}intent:shipping`
  }
  if (/(多少钱|价格|多少米|几块|几元|优惠|活动价|到手价)/u.test(questionKey)) {
    return `${slotScope}intent:price`
  }
  if (
    /(几盒|几斤|几瓶|几袋|几包|几件|多少盒|多少斤|多少瓶|多少袋|规格|多大|尺寸|重量|净重)/u.test(
      questionKey,
    )
  ) {
    return `${slotScope}intent:spec`
  }
  if (/(还有吗|有货|库存|现货|能拍|可以拍|还能拍)/u.test(questionKey)) {
    return `${slotScope}intent:stock`
  }
  if (/(保质|日期|生产日期|过期|新鲜)/u.test(questionKey)) {
    return `${slotScope}intent:shelf-life`
  }
  if (/(正品|真假|真的|效果|好用|有用)/u.test(questionKey)) {
    return `${slotScope}intent:quality`
  }
  if (HISTORY_ORDER_CONFIRMATION_PATTERN.test(questionKey)) {
    return 'intent:order-confirmed'
  }

  return `exact:${questionKey}`
}

export function getAutoReplyHistorySemanticKeywordAliases(question: string) {
  const semanticKey = getAutoReplyHistorySemanticGroupKey(question)
  if (semanticKey === 'intent:order-confirmed') {
    return HISTORY_ORDER_CONFIRMATION_KEYWORDS
  }
  return []
}

export function isAutoReplyHistorySemanticConfiguredForMessage(
  message: Message,
  config?: AutoReplyWorkbenchKeywordConfig,
) {
  if (!isAutoReplyTextComment(message) || !config?.comment.keywordReply.enable) return false

  const detail = getAutoReplyMessageDetail(message).trim()
  const semanticKey = getAutoReplyHistorySemanticGroupKey(detail)
  if (!semanticKey || getAutoReplyHistorySemanticKeywordAliases(detail).length === 0) {
    return false
  }

  return config.comment.keywordReply.rules.some(rule => {
    const hasReplyContent = rule.contents.some(content => content.trim())
    if (!hasReplyContent) return false

    return rule.keywords.some(keyword => {
      const normalizedKeyword = keyword.trim()
      if (
        !normalizedKeyword ||
        getAutoReplyHistorySemanticKeywordAliases(normalizedKeyword).length === 0
      ) {
        return false
      }
      return getAutoReplyHistorySemanticGroupKey(normalizedKeyword) === semanticKey
    })
  })
}

export function getAutoReplyHistoryRuleCandidateState({
  comment,
  reply,
  config,
  duplicateCount = 1,
}: {
  comment: Message
  reply?: ReplyPreview
  config?: AutoReplyWorkbenchKeywordConfig
  duplicateCount?: number
}) {
  const detail = getAutoReplyMessageDetail(comment).trim()
  const basis = buildAutoReplyKnowledgeBasis(detail)
  const isConfigured =
    isAutoReplyKeywordReplyConfiguredForMessage(comment, config) ||
    isAutoReplyHistorySemanticConfiguredForMessage(comment, config)
  const hasReply = Boolean(reply?.replyContent.trim())
  const hasReusableIntent = HISTORY_CONFIG_INTENT_PATTERN.test(detail)
  const hasDuplicate = duplicateCount > 1
  const reasons: string[] = []

  if (hasDuplicate) {
    reasons.push(`同类 ${duplicateCount} 条`)
  }
  if (hasReply) {
    reasons.push(reply?.isSent ? '已回复可复用' : '有建议回复')
  }
  if (hasReusableIntent) {
    reasons.push('常见问法')
  }

  return {
    isConfigured,
    isCandidate:
      !isConfigured &&
      detail.length > 0 &&
      basis.keywords.length > 0 &&
      (hasDuplicate || hasReply || hasReusableIntent),
    duplicateCount,
    hasReply,
    hasReusableIntent,
    reasons,
    keywords: basis.keywords,
  }
}

export function mergeAutoReplyKnowledgeRules(
  rules: AutoReplyKnowledgeRule[],
  next: AutoReplyKnowledgeRule,
) {
  const keywords = uniqueTextList(next.keywords, AUTO_REPLY_SAVED_KEYWORD_LIMIT)
  const contents = uniqueTextList(next.contents, AUTO_REPLY_SAVED_CONTENT_LIMIT)
  if (!keywords.length || !contents.length) return rules

  const nextKeywordKeys = new Set(keywords.map(normalizeKnowledgeText))
  const targetIndex = rules.findIndex(rule =>
    rule.keywords.some(keyword => nextKeywordKeys.has(normalizeKnowledgeText(keyword))),
  )

  if (targetIndex < 0) {
    return [{ keywords, contents }, ...rules]
  }

  return rules.map((rule, index) => {
    if (index !== targetIndex) return rule
    return {
      keywords: uniqueTextList([...rule.keywords, ...keywords], AUTO_REPLY_SAVED_KEYWORD_LIMIT),
      contents: uniqueTextList([...rule.contents, ...contents], AUTO_REPLY_SAVED_CONTENT_LIMIT),
    }
  })
}

function getMessageUserId(message: Message) {
  return 'user_id' in message && typeof message.user_id === 'string' ? message.user_id.trim() : ''
}

function normalizeThreadMessageName(message: Message) {
  return normalizeAutoReplyNickname(getAutoReplyMessageDisplayName(message))
}

function isSameViewerThread(message: Message, selectedComment: Message) {
  const messageUserId = getMessageUserId(message)
  const selectedUserId = getMessageUserId(selectedComment)

  if (messageUserId && selectedUserId) {
    return messageUserId === selectedUserId
  }

  return normalizeThreadMessageName(message) === normalizeThreadMessageName(selectedComment)
}

function parseSortTime(value: string | undefined, fallbackOrder: number, nowMs = Date.now()) {
  if (!value) return fallbackOrder

  const clockMatch = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i)
  if (clockMatch) {
    const meridiem = clockMatch[4]?.toUpperCase()
    let hours = Number(clockMatch[1])
    if (meridiem === 'PM' && hours < 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0

    const today = new Date(nowMs)
    today.setHours(hours, Number(clockMatch[2]), Number(clockMatch[3] ?? 0), 0)
    return today.getTime()
  }

  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? fallbackOrder : parsed
}

export function getAutoReplyMessageSortTime(
  message: Message,
  fallbackOrder = 0,
  nowMs = Date.now(),
) {
  return parseSortTime(message.time, fallbackOrder, nowMs)
}

export function getAutoReplyMessageAgeMs(message: Message, nowMs = Date.now()) {
  const fallbackOrder = -1
  const sortTime = getAutoReplyMessageSortTime(message, fallbackOrder, nowMs)
  if (sortTime === fallbackOrder) return 0
  return Math.max(0, nowMs - sortTime)
}

export function isAutoReplyKeywordReplyConfiguredForMessage(
  message: Message,
  config?: AutoReplyWorkbenchKeywordConfig,
) {
  return Boolean(getAutoReplyKeywordReplyMatchForMessage(message, config))
}

export function getAutoReplyKeywordReplyMatchForMessage(
  message: Message,
  config?: AutoReplyWorkbenchKeywordConfig,
): AutoReplyKeywordReplyMatch | null {
  if (!isAutoReplyTextComment(message) || !config?.comment.keywordReply.enable) return null

  const commentContent = getAutoReplyMessageDetail(message).trim()
  if (!commentContent) return null

  for (const rule of config.comment.keywordReply.rules) {
    const keywords = rule.keywords.map(keyword => keyword.trim()).filter(Boolean)
    const contents = rule.contents.map(content => content.trim()).filter(Boolean)
    const keyword = keywords.find(keyword => commentContent.includes(keyword))

    if (keyword && contents.length > 0) {
      return {
        keyword,
        content: contents[0],
        rule,
      }
    }
  }

  return null
}

export function getAutoReplyWorkbenchTaskState({
  task,
  config,
  nowMs = Date.now(),
  ignoreAfterMs = AUTO_REPLY_WORKBENCH_IGNORE_AFTER_MS,
}: {
  task: WorkbenchTask
  config?: AutoReplyWorkbenchKeywordConfig
  nowMs?: number
  ignoreAfterMs?: number
}): AutoReplyWorkbenchTaskState {
  const isSent = Boolean(task.reply?.isSent)
  const isIgnored = !isSent && getAutoReplyMessageAgeMs(task.comment, nowMs) > ignoreAfterMs
  const isConfigured = isAutoReplyKeywordReplyConfiguredForMessage(task.comment, config)
  const isUnconfigured = !isConfigured
  let status: AutoReplyWorkbenchTaskStatus = 'unconfigured'

  if (isSent) {
    status = 'sent'
  } else if (isIgnored) {
    status = 'ignored'
  } else if (isConfigured) {
    status = 'configured'
  }

  return {
    status,
    isSent,
    isIgnored,
    isConfigured,
    isUnconfigured,
  }
}

export function getAutoReplyWorkbenchTaskStatus(
  options: Parameters<typeof getAutoReplyWorkbenchTaskState>[0],
): AutoReplyWorkbenchTaskStatus {
  return getAutoReplyWorkbenchTaskState(options).status
}

function sortConversationMessages(
  left: Pick<WorkbenchConversationMessage, 'sortTime' | 'role' | 'order'>,
  right: Pick<WorkbenchConversationMessage, 'sortTime' | 'role' | 'order'>,
) {
  if (left.sortTime !== right.sortTime) return left.sortTime - right.sortTime
  if (left.role !== right.role) return left.role === 'viewer' ? -1 : 1
  return left.order - right.order
}

export function buildAutoReplyWorkbenchTasks({
  comments,
  replies,
  operatorName,
}: {
  comments: Message[]
  replies: ReplyPreview[]
  operatorName?: AutoReplyOperatorName
}): WorkbenchTask[] {
  const replyByCommentId = new Map(replies.map(reply => [reply.commentId, reply]))
  const tasks: WorkbenchTask[] = []

  comments.forEach(comment => {
    if (!isAutoReplyViewerComment(comment, operatorName)) return

    if (tasks.some(task => isSameViewerThread(task.comment, comment))) return

    tasks.push({ comment, reply: replyByCommentId.get(comment.msg_id) })
  })

  return tasks
}

export function buildScopedAutoReplyWorkbenchTasks({
  sources,
}: {
  sources: ScopedWorkbenchSource[]
}): ScopedWorkbenchTask[] {
  const scopedTasks: Array<ScopedWorkbenchTask & { sourceOrder: number }> = []

  sources.forEach((source, sourceIndex) => {
    const sourceTasks = buildAutoReplyWorkbenchTasks({
      comments: source.comments,
      replies: source.replies,
      operatorName: source.operatorName,
    })

    sourceTasks.forEach(task => {
      const commentIndex = source.comments.findIndex(
        comment => comment.msg_id === task.comment.msg_id,
      )
      const fallbackOrder =
        (sources.length - sourceIndex) * 100000 + source.comments.length - Math.max(commentIndex, 0)

      scopedTasks.push({
        ...task,
        accountId: source.accountId,
        accountName: source.accountName,
        platformLabel: source.platformLabel,
        operatorName: source.operatorName,
        taskKey: getAutoReplyWorkbenchTaskKey(source.accountId, task.comment.msg_id),
        sortTime: getAutoReplyMessageSortTime(task.comment, fallbackOrder),
        sourceOrder: sourceIndex,
      })
    })
  })

  return scopedTasks
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
      if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder - right.sourceOrder
      return left.taskKey.localeCompare(right.taskKey)
    })
    .map(({ sourceOrder: _sourceOrder, ...task }) => task)
}

export function formatAutoReplyConversationTime(value?: string) {
  const trimmedValue = value?.trim()
  if (!trimmedValue) return ''

  const clockMatch = trimmedValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i)
  if (clockMatch) {
    const meridiem = clockMatch[4]?.toUpperCase()
    let hours = Number(clockMatch[1])
    if (meridiem === 'PM' && hours < 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0

    return `${String(hours).padStart(2, '0')}:${clockMatch[2]}:${clockMatch[3] ?? '00'}`
  }

  const parsed = new Date(trimmedValue)
  if (Number.isNaN(parsed.getTime())) return trimmedValue

  return parsed.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function getDuplicateConversationCommentKey(message: WorkbenchConversationMessage) {
  const contentKey = message.content.trim().replace(/\s+/g, '')
  if (!contentKey) return ''

  return `${normalizeAutoReplyNickname(message.author)}:${contentKey}`
}

function dedupeConversationCommentMessages(messages: WorkbenchConversationMessage[]) {
  const byDuplicateKey = new Map<string, WorkbenchConversationMessage[]>()
  const result: WorkbenchConversationMessage[] = []

  for (const message of [...messages].sort(sortConversationMessages)) {
    const duplicateKey = getDuplicateConversationCommentKey(message)
    const existing = duplicateKey
      ? byDuplicateKey
          .get(duplicateKey)
          ?.find(
            candidate =>
              Math.abs(candidate.sortTime - message.sortTime) <=
              DUPLICATE_CONTEXT_COMMENT_WINDOW_MS,
          )
      : undefined

    if (existing) {
      existing.isCurrentComment = existing.isCurrentComment || message.isCurrentComment
      continue
    }

    result.push(message)
    if (duplicateKey) {
      byDuplicateKey.set(duplicateKey, [...(byDuplicateKey.get(duplicateKey) ?? []), message])
    }
  }

  return result
}

export function buildAutoReplyWorkbenchConversation({
  selectedComment,
  comments,
  replies,
  operatorName,
  limit = 16,
}: {
  selectedComment?: Message
  comments: Message[]
  replies: ReplyPreview[]
  operatorName?: AutoReplyOperatorName
  limit?: number
}) {
  if (!selectedComment) return []

  const threadComments = comments.filter(comment => isSameViewerThread(comment, selectedComment))
  if (!threadComments.some(comment => comment.msg_id === selectedComment.msg_id)) {
    threadComments.push(selectedComment)
  }

  const threadCommentIds = new Set(threadComments.map(comment => comment.msg_id))
  const commentMessages = dedupeConversationCommentMessages(
    threadComments.map((comment, index) => {
      const fallbackOrder = comments.length - index
      return {
        id: `comment:${comment.msg_id}`,
        role: 'viewer',
        author: getAutoReplyMessageDisplayName(comment),
        content: getAutoReplyMessageDetail(comment),
        at: comment.time,
        timeLabel: formatAutoReplyConversationTime(comment.time),
        sortTime: parseSortTime(comment.time, fallbackOrder),
        order: fallbackOrder,
        commentId: comment.msg_id,
        isCurrentComment: comment.msg_id === selectedComment.msg_id,
      }
    }),
  )

  const operatorMessages: WorkbenchConversationMessage[] = replies
    .filter(reply => reply.isSent && threadCommentIds.has(reply.commentId))
    .map((reply, index) => {
      const fallbackOrder = comments.length + replies.length - index
      return {
        id: `reply:${reply.id}`,
        role: 'operator',
        author: getAutoReplyOperatorDisplayName(operatorName),
        content: reply.replyContent,
        at: reply.time,
        timeLabel: formatAutoReplyConversationTime(reply.time),
        sortTime: parseSortTime(reply.time, fallbackOrder),
        order: fallbackOrder,
        commentId: reply.commentId,
        replyId: reply.id,
        replyKind: reply.source,
        sourceLabel: getConversationReplySourceLabel(reply),
      }
    })

  return [...commentMessages, ...operatorMessages].sort(sortConversationMessages).slice(-limit)
}
