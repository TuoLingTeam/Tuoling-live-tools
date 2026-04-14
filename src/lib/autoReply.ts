import { AUTO_REPLY } from '@/constants'

const AUTO_REPLY_SYSTEM_DEFAULT_RULES = [
  '你是直播间口播助手，只替主播回复观众评论。',
  '每次只回复一句，15到28字优先，绝不要超过40字。',
  '语气像真人主播接话，自然、顺口、有互动感，不要像客服，不要像AI助手。',
  '闲聊、打招呼、夸主播时，先自然回应，不要强行带货。',
  '如果系统没有提供真实商品事实，禁止输出具体链接号、商品名、价格、优惠、库存、主推信息。',
  '问商品时，优先用“几号链接 + 短称呼 + 一个重点”回答。',
  '不要复述完整商品长标题，不要连续堆多个卖点，不要像念详情页。',
  '问价格先回价格，问介绍先回一个卖点，问库存先回库存状态。',
  '用户问题不明确时，先短接话，不要输出大段介绍。',
  '不要分点，不要解释分析过程，不要输出备注、前缀、括号说明。',
  '不要反复说“点链接看看哦”“可以了解一下哦”。',
  '禁止极限词、绝对化、承诺式表达，如：最、第一、全网最低、绝对、百分百、保证、永久、无敌、闭眼入。',
  '禁止强刺激下单话术，如：赶紧拍、马上下单、不买就亏、错过就没了、最后几单、今天必须拍。',
  '不要主动提抽奖、返现、红包、私下交易、加微信、私聊、刷单。',
  '不要涉及医疗、保健、减肥、美白、治病、功效保证。',
  '不要编造价格、库存、优惠、活动、销量。',
  '一旦自然回复和平台合规冲突，优先保证合规。',
  '你只需要输出最终要发送给观众的一句话回复。',
  '不要输出 JSON，不要复述输入，不要添加“回复：”“建议回复：”“最终回复：”等前缀。',
  '不要包含 nickname、content 等字段名，不要输出代码块。',
  '只回答最后一条评论，前面的内容只作为参考，不要机械重复之前的话术。',
].join('\n')

const JSON_COMMENT_PATTERN =
  /\{[^{}]*"nickname"\s*:\s*"[^"]*"[^{}]*"content"\s*:\s*"[^"]*"[^{}]*\}/g

const OUTPUT_LABEL_PATTERN = /^(?:回复内容|最终回复|建议回复|回复|输出)[:：]\s*/i

function stripMarkdownCodeFence(text: string) {
  return text.replace(/```[\s\S]*?```/g, block => block.replace(/```/g, ' '))
}

function isJsonEchoLine(line: string) {
  const normalized = line.trim()
  if (!normalized) return false
  if (normalized.includes('"nickname"') || normalized.includes('"content"')) {
    return true
  }
  return normalized.startsWith('{') || normalized.startsWith('[')
}

function cleanCandidateText(text: string) {
  return text
    .replace(JSON_COMMENT_PATTERN, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isJsonEchoLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function unwrapOutputLabel(text: string) {
  const lines = text.split('\n')
  const normalizedLines = lines.map(line => line.trim()).filter(Boolean)
  const lastLine = normalizedLines.at(-1) ?? ''
  const unwrappedLastLine = lastLine.replace(OUTPUT_LABEL_PATTERN, '').trim()

  if (unwrappedLastLine && unwrappedLastLine !== lastLine) {
    return unwrappedLastLine
  }

  return text
}

export interface AutoReplyCommentInput {
  msg_id: string
  nick_name: string
  content: string
  time: string
}

export interface AutoReplyPreviewInput {
  commentId: string
  replyFor: string
  replyContent: string
  time: string
  isSent: boolean
}

export interface AutoReplyConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AutoReplyConversationOptions {
  mode?: 'latest-turn' | 'current-only'
}

export type AutoReplyAutoSendScope = 'all' | 'safe-only'
export type AutoReplyAutoSendBlockedReason =
  | 'after-sales'
  | 'private-contact'
  | 'medical-sensitive'
  | 'abuse-conflict'
  | 'reply-compliance'

const COMMENT_AUTO_SEND_BLOCK_RULES: Array<{
  reason: AutoReplyAutoSendBlockedReason
  pattern: RegExp
}> = [
  {
    reason: 'after-sales',
    pattern:
      /(退款|退货|售后|质量问题|坏了|破损|发错|漏发|没收到|投诉|举报|赔偿|假货|催发货|多久发货|发货了没)/i,
  },
  {
    reason: 'private-contact',
    pattern: /(微信|加微|加v|vx|v信|私聊|私信|联系方式|手机号|电话|QQ|二维码|拉群)/i,
  },
  {
    reason: 'medical-sensitive',
    pattern:
      /(治病|治疗|药效|副作用|孕妇|哺乳期|过敏体质|高血压|糖尿病|减肥|瘦身|美白|祛斑|丰胸|激素|处方)/i,
  },
  {
    reason: 'abuse-conflict',
    pattern: /(骗子|骗人|垃圾|差评|坑人|举报你|投诉你|滚|有病吧)/i,
  },
]

const REPLY_AUTO_SEND_BLOCK_RE =
  /(加微信|私聊|返现|红包|刷单|全网最低|绝对|保证|包治|治疗|药效|减肥|美白|百分百)/i

function toCommentPayload(comment: Pick<AutoReplyCommentInput, 'nick_name' | 'content'>) {
  return JSON.stringify({
    nickname: comment.nick_name,
    content: comment.content ?? '',
  })
}

export function buildAutoReplyConversation(
  currentComment: AutoReplyCommentInput,
  allComments: AutoReplyCommentInput[],
  allReplies: AutoReplyPreviewInput[],
  options?: AutoReplyConversationOptions,
): AutoReplyConversationMessage[] {
  const mode = options?.mode ?? 'latest-turn'
  const latestSentReply = allReplies
    .filter(reply => reply.replyFor === currentComment.nick_name && reply.isSent)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .at(-1)

  const messages: AutoReplyConversationMessage[] = []

  if (mode === 'latest-turn' && latestSentReply) {
    const repliedComment = allComments.find(comment => comment.msg_id === latestSentReply.commentId)
    if (repliedComment && repliedComment.msg_id !== currentComment.msg_id) {
      messages.push({
        role: 'user',
        content: toCommentPayload(repliedComment),
      })
    }

    messages.push({
      role: 'assistant',
      content: latestSentReply.replyContent,
    })
  }

  messages.push({
    role: 'user',
    content: toCommentPayload(currentComment),
  })

  return messages
}

export function buildAutoReplySystemPrompt(prompt: string, sharedSystemPrompt?: string) {
  const normalizedUserPrompt = prompt.trim()
  const userSupplement =
    normalizedUserPrompt && normalizedUserPrompt !== AUTO_REPLY.LEGACY_USER_PROMPT.trim()
      ? normalizedUserPrompt
      : ''
  const sections = [
    sharedSystemPrompt?.trim(),
    '你将接收到一个或多个 JSON 字符串，每个字符串代表用户评论，格式为 {"nickname": "用户昵称", "content": "评论内容"}。',
    AUTO_REPLY_SYSTEM_DEFAULT_RULES,
    userSupplement ? `用户补充要求：\n${userSupplement}` : '',
  ]

  return sections.filter(Boolean).join('\n\n')
}

export function sanitizeAutoReplyResponse(replyContent: string) {
  const normalized = stripMarkdownCodeFence(replyContent).trim()
  if (!normalized) {
    return null
  }

  const cleaned = cleanCandidateText(normalized)
  if (!cleaned) {
    return null
  }

  const unwrapped = unwrapOutputLabel(cleaned)
  const finalReply = unwrapped.trim()

  if (!finalReply) {
    return null
  }

  if (
    finalReply.includes('"nickname"') ||
    finalReply.includes('"content"') ||
    /^[{[]/.test(finalReply)
  ) {
    return null
  }

  return enforceAutoReplyLength(finalReply)
}

export function enforceAutoReplyLength(
  replyContent: string,
  maxLength = AUTO_REPLY.MAX_SEND_LENGTH,
) {
  const normalized = replyContent.trim()
  const chars = Array.from(normalized)

  if (chars.length <= maxLength) {
    return normalized
  }

  return chars.slice(0, maxLength).join('').trimEnd()
}

export function createReplyFingerprint(replyContent: string) {
  return replyContent
    .trim()
    .replace(/[！!。,.，？?~～\s]+/g, '')
    .toLowerCase()
}

export function shouldSkipDuplicateReply(params: {
  replyContent: string
  lastReplyContent?: string
  lastReplyAt?: number
  cooldownMs?: number
}) {
  const { replyContent, lastReplyContent, lastReplyAt, cooldownMs = 90_000 } = params
  if (!lastReplyContent || !lastReplyAt) {
    return false
  }

  const withinCooldown = Date.now() - lastReplyAt < cooldownMs
  if (!withinCooldown) {
    return false
  }

  return createReplyFingerprint(replyContent) === createReplyFingerprint(lastReplyContent)
}

export function shouldAutoSendAutoReply(params: {
  autoSend: boolean
  mode: 'product-kb' | 'safe-fallback' | 'ai'
  scope?: AutoReplyAutoSendScope
}) {
  const { autoSend, mode, scope = 'safe-only' } = params
  if (!autoSend) {
    return false
  }

  if (scope === 'all') {
    return true
  }

  return mode !== 'ai'
}

export function getAutoReplyAutoSendBlockedReason(params: {
  commentContent: string
  replyContent: string
}): AutoReplyAutoSendBlockedReason | undefined {
  const { commentContent, replyContent } = params
  const normalizedComment = commentContent.trim()
  const normalizedReply = replyContent.trim()

  for (const rule of COMMENT_AUTO_SEND_BLOCK_RULES) {
    if (rule.pattern.test(normalizedComment)) {
      return rule.reason
    }
  }

  if (REPLY_AUTO_SEND_BLOCK_RE.test(normalizedReply)) {
    return 'reply-compliance'
  }

  return undefined
}
