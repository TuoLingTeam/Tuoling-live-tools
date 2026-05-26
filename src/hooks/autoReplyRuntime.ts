import { providers } from 'shared/providers'
import { AUTO_REPLY } from '@/constants'
import {
  type AutoReplyAutoSendBlockedReason,
  buildAutoReplyConversation,
  buildAutoReplySystemPrompt,
  enforceAutoReplyLength,
  getAutoReplyAutoSendBlockedReason,
  sanitizeAutoReplyResponse,
  shouldAutoSendAutoReply,
} from '@/lib/autoReply'
import { areSameAutoReplyViewerName, getAutoReplyDisplayName } from '@/lib/autoReplyIdentity'
import { buildProductKnowledgePolishPrompt } from '@/lib/productKnowledge'
import { matchObject } from '@/utils/filter'
import type { CommentMessage, EventMessageType, Message, ReplyPreview } from './autoReplyTypes'
import { type AIChatContextMessage, type AIProvider, useAIChatStore } from './useAIChat'
import { getEffectiveAICredentials } from './useAITrial'
import type { AutoReplyConfig, SimpleEventReply } from './useAutoReplyConfig'

export type AutoReplyErrorHandler = (error: unknown, message?: string) => void

export function getRandomElement<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined
  const randomIndex = Math.floor(Math.random() * arr.length)
  return arr[randomIndex]
}

export async function sendMessage(
  accountId: string,
  content: string,
  errorHandler: AutoReplyErrorHandler,
): Promise<boolean> {
  if (!content) return false
  try {
    const sent = await window.autoReplyAPI.sendReply(accountId, content)
    if (!sent) {
      errorHandler(new Error('send_reply_failed'), '自动发送回复失败')
      return false
    }
    return sent
  } catch (err) {
    errorHandler(err, '自动发送回复失败')
    return false
  }
}

export function replaceUsername(content: string, username: string, mask: boolean) {
  if (!content) return ''
  const displayedUsername = getMentionDisplayName(username, mask)
  return content.replace(new RegExp(AUTO_REPLY.USERNAME_PLACEHOLDER, 'g'), displayedUsername)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getMentionDisplayName(username: string, mask: boolean) {
  return mask ? `${String.fromCodePoint(username.codePointAt(0) ?? 42)}***` : username.trim()
}

export function prependUsernameMention(content: string, username: string, mask: boolean) {
  const normalizedContent = content.trim()
  const displayedUsername = getMentionDisplayName(username, mask)

  if (!normalizedContent || !displayedUsername) {
    return normalizedContent
  }

  const mentionPrefix = `@${displayedUsername}`
  if (normalizedContent.startsWith(mentionPrefix)) {
    return normalizedContent
  }

  const directAddressPattern = new RegExp(`^${escapeRegExp(displayedUsername)}[\\s,，:：]+`)
  if (directAddressPattern.test(normalizedContent)) {
    return normalizedContent.replace(directAddressPattern, `${mentionPrefix} `).trim()
  }

  return `${mentionPrefix} ${normalizedContent}`
}

const EVENT_REPLY_TYPES = new Set<EventMessageType>([
  'room_enter',
  'room_like',
  'live_order',
  'subscribe_merchant_brand_vip',
  'room_follow',
  'ecom_fansclub_participate',
])

function getSimpleEventReplyConfig(
  config: AutoReplyConfig,
  messageType: Message['msg_type'],
): SimpleEventReply | null {
  if (!EVENT_REPLY_TYPES.has(messageType as EventMessageType)) {
    return null
  }

  const replyConfig = config[messageType as EventMessageType]
  if (!replyConfig || !Array.isArray(replyConfig.messages)) {
    return null
  }

  return replyConfig
}

export function buildMentionedReplyContent(content: string, nickname: string, mask: boolean) {
  return enforceAutoReplyLength(
    prependUsernameMention(content, getAutoReplyDisplayName(nickname), mask),
  )
}

export function stripMentionedReplyContent(content: string, nickname: string, mask: boolean) {
  const normalizedContent = content.trim()
  const displayedUsername = getMentionDisplayName(getAutoReplyDisplayName(nickname), mask)
  if (!normalizedContent || !displayedUsername) {
    return normalizedContent
  }

  const mentionPattern = new RegExp(`^@${escapeRegExp(displayedUsername)}[\\s,，:：]*`)
  return normalizedContent.replace(mentionPattern, '').trim()
}

export function sendConfiguredReply(
  accountId: string,
  config: AutoReplyConfig,
  sourceMessage: Message,
  errorHandler: AutoReplyErrorHandler,
): void {
  const replyConfig = getSimpleEventReplyConfig(config, sourceMessage.msg_type)
  if (!replyConfig) return

  if (replyConfig.enable && replyConfig.messages.length > 0) {
    const filterMessages = []
    const pureMessages = []
    for (const message of replyConfig.messages) {
      if (typeof message === 'string') {
        pureMessages.push(message)
      } else if (matchObject(sourceMessage, message.filter)) {
        filterMessages.push(message.content)
      }
    }
    const replyMessages = filterMessages.length ? filterMessages : pureMessages
    const content = getRandomElement(replyMessages)
    if (content) {
      const namedMessage = replaceUsername(
        content,
        getAutoReplyDisplayName(sourceMessage.nick_name),
        config.hideUsername,
      )
      const message = buildMentionedReplyContent(
        namedMessage,
        sourceMessage.nick_name,
        config.hideUsername,
      )
      void sendMessage(accountId, message, errorHandler)
    }
  }
}

export function handleKeywordReply(
  comment: CommentMessage,
  config: AutoReplyConfig,
  accountId: string,
  errorHandler: AutoReplyErrorHandler,
): boolean {
  const commentContent = typeof comment.content === 'string' ? comment.content.trim() : ''
  if (!config.comment.keywordReply.enable || !commentContent) {
    return false
  }

  const rule = config.comment.keywordReply.rules.find(({ keywords }) =>
    keywords.some(keyword => commentContent.includes(keyword)),
  )

  if (rule && rule.contents.length > 0) {
    const content = getRandomElement(rule.contents)
    if (content) {
      const namedMessage = replaceUsername(
        content,
        getAutoReplyDisplayName(comment.nick_name),
        config.hideUsername,
      )
      const message = buildMentionedReplyContent(
        namedMessage,
        comment.nick_name,
        config.hideUsername,
      )
      void sendMessage(accountId, message, errorHandler)
      return true
    }
  }

  return false
}

export function getAISharedConfig(feature: 'chat' | 'auto_reply' | 'knowledge_draft' = 'chat') {
  const store = useAIChatStore.getState()
  const provider = store.config.provider
  const providerConfig = providers[provider]
  const credentials = getEffectiveAICredentials({
    feature,
    userProvider: provider,
    userModel: store.config.model,
    userApiKey: store.apiKeys[provider] || '',
    userCustomBaseURL: store.customBaseURL || providerConfig.baseURL,
  })

  return {
    provider: credentials?.provider ?? provider,
    model: credentials?.model ?? store.config.model,
    apiKey: credentials?.apiKey ?? (store.apiKeys[provider] || ''),
    baseURL: credentials?.customBaseURL ?? (store.customBaseURL || providerConfig.baseURL),
    temperature: store.config.temperature ?? 0.7,
    systemPrompt: store.systemPrompt || '你是一个 helpful assistant',
    recentMessages: store.messages.slice(-6).map(message => ({
      role: message.role,
      content: message.content,
    })),
  }
}

export async function handleAIReply(
  accountId: string,
  comment: CommentMessage,
  allComments: Message[],
  allReplies: ReplyPreview[],
  config: AutoReplyConfig,
  {
    provider,
    model,
    apiKey,
    customBaseURL,
    conversationMode = 'latest-turn',
    allowAutoSend,
  }: {
    provider: AIProvider
    model: string
    apiKey: string
    customBaseURL: string
    conversationMode?: 'latest-turn' | 'current-only'
    allowAutoSend?: boolean
  },
  onReply: (
    content: string,
    isSent?: boolean,
    autoSendBlockedReason?: AutoReplyAutoSendBlockedReason,
  ) => void,
  errorHandler: AutoReplyErrorHandler,
) {
  if (!config.comment.aiReply.enable) return

  const { prompt, autoSend } = config.comment.aiReply
  const useSharedConfig = config.comment.aiReply.useSharedConfig ?? false
  const commentContent = typeof comment.content === 'string' ? comment.content.trim() : ''

  let aiConfig: {
    provider: AIProvider
    model: string
    apiKey: string
    customBaseURL: string
    temperature?: number
    systemPrompt?: string
    recentMessages?: Array<Pick<AIChatContextMessage, 'role' | 'content'>>
  }

  if (useSharedConfig) {
    const sharedConfig = getAISharedConfig('auto_reply')
    aiConfig = {
      provider: sharedConfig.provider as AIProvider,
      model: sharedConfig.model,
      apiKey: sharedConfig.apiKey,
      customBaseURL: sharedConfig.baseURL,
      temperature: sharedConfig.temperature,
      systemPrompt: sharedConfig.systemPrompt,
      recentMessages: sharedConfig.recentMessages,
    }
  } else {
    aiConfig = {
      provider,
      model,
      apiKey,
      customBaseURL,
    }
  }

  if (!aiConfig.apiKey?.trim()) {
    console.warn('[AutoReply] Missing effective AI credentials, skipping AI reply generation')
    return
  }

  const userComments = [comment, ...allComments].filter(
    currentComment =>
      (currentComment.msg_type === 'comment' ||
        currentComment.msg_type === 'wechat_channel_live_msg') &&
      areSameAutoReplyViewerName(currentComment.nick_name, comment.nick_name),
  ) as CommentMessage[]
  const userReplies = allReplies.filter(reply =>
    areSameAutoReplyViewerName(reply.replyFor, comment.nick_name),
  )
  const plainMessages = buildAutoReplyConversation(comment, userComments, userReplies, {
    mode: conversationMode,
  })
  const systemPrompt = buildAutoReplySystemPrompt(
    prompt,
    useSharedConfig ? aiConfig.systemPrompt : undefined,
  )
  const messages: AIChatContextMessage[] = [{ role: 'system', content: systemPrompt }]
  const sharedRecentMessages = useSharedConfig
    ? (aiConfig.recentMessages ?? []).filter(
        message =>
          message.role !== 'system' &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0,
      )
    : []

  messages.push(...sharedRecentMessages, ...plainMessages)

  try {
    const rawReplyContent = await window.aiChatAPI.normalChat({
      messages,
      provider: aiConfig.provider,
      model: aiConfig.model,
      apiKey: aiConfig.apiKey,
      customBaseURL: aiConfig.customBaseURL,
      temperature: aiConfig.temperature,
    })

    if (rawReplyContent && typeof rawReplyContent === 'string') {
      const replyContent = sanitizeAutoReplyResponse(rawReplyContent)
      if (!replyContent) {
        console.warn('[AutoReply] Discarded invalid AI reply:', rawReplyContent)
        return
      }

      const finalReplyContent = buildMentionedReplyContent(
        replyContent,
        comment.nick_name,
        config.hideUsername,
      )

      const autoSendBlockedReason = getAutoReplyAutoSendBlockedReason({
        commentContent,
        replyContent: finalReplyContent,
      })

      let isSent = false
      if ((allowAutoSend ?? autoSend) === true && !autoSendBlockedReason) {
        isSent = await sendMessage(accountId, finalReplyContent, errorHandler)
      }
      onReply(finalReplyContent, isSent, autoSendBlockedReason)
    }
  } catch (err) {
    errorHandler(err, 'AI 生成回复失败')
  }
}

export async function maybePolishProductKnowledgeReply({
  commentText,
  templateReply,
  knowledgeItem,
  config,
  productPrompt,
  provider,
  model,
  apiKey,
  customBaseURL,
}: {
  commentText: string
  templateReply: string
  knowledgeItem: {
    id: number
    title?: string
    shortTitle?: string
    priceText?: string
    promoText?: string
    stockText?: string
    highlights?: string[]
    aliases?: string[]
    faq?: Array<{ q: string; a: string }>
  }
  config: AutoReplyConfig
  productPrompt?: string
  provider: AIProvider
  model: string
  apiKey: string
  customBaseURL: string
}) {
  if (!config.comment.aiReply.enable || !apiKey) {
    return templateReply
  }

  try {
    const polished = await window.aiChatAPI.normalChat({
      messages: [
        {
          role: 'system',
          content: buildProductKnowledgePolishPrompt({
            comment: commentText,
            templateReply,
            item: knowledgeItem,
            userPrompt: productPrompt,
          }),
        },
      ],
      provider,
      model,
      apiKey,
      customBaseURL,
      temperature: config.comment.aiReply.useSharedConfig
        ? getAISharedConfig('auto_reply').temperature
        : undefined,
    })

    if (typeof polished !== 'string' || !polished.trim()) {
      return templateReply
    }

    return sanitizeAutoReplyResponse(polished) ?? templateReply
  } catch {
    return templateReply
  }
}

export function shouldAutoSendForAutoReplyMode(
  config: AutoReplyConfig,
  mode: 'product-kb' | 'safe-fallback' | 'ai',
) {
  return shouldAutoSendAutoReply({
    autoSend: config.comment.aiReply.autoSend,
    mode,
    scope: config.comment.aiReply.autoSendScope,
  })
}

export function getAutoSendBlockedReasonForPreview(params: {
  commentContent: string
  replyContent: string
}) {
  return getAutoReplyAutoSendBlockedReason(params)
}
