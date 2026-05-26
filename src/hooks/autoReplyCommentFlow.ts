import type { MutableRefObject } from 'react'
import { areSameAutoReplyViewerName, isAutoReplyHostNickname } from '@/lib/autoReplyIdentity'
import type {
  AddReply,
  RecentReplyCacheRef,
  ViewerProductSessionRef,
} from './autoReplyCommentShared'
import { handleAutoReplyProductReplyFlow } from './autoReplyProductReplyFlow'
import {
  type AutoReplyErrorHandler,
  handleKeywordReply,
  sendConfiguredReply,
} from './autoReplyRuntime'
import type { CommentMessage, Message, ReplyPreview } from './autoReplyTypes'
import type { AIProvider } from './useAIChat'
import type { AutoReplyConfig } from './useAutoReplyConfig'

export async function processAutoReplyComment(params: {
  comment: Message
  commentContent: string
  accountId: string
  accountName?: string | string[] | null
  config: AutoReplyConfig
  allComments: Message[]
  allReplies: ReplyPreview[]
  provider: AIProvider
  model: string
  apiKeys: Record<AIProvider, string>
  customBaseURL: string
  addReply: AddReply
  markReplySent: (accountId: string, commentId: string) => void
  handleError: AutoReplyErrorHandler
  ensureTrialSession: (feature: 'chat' | 'auto_reply' | 'knowledge_draft') => Promise<unknown>
  reportTrialUse: (params: {
    feature: 'chat' | 'auto_reply' | 'knowledge_draft'
    model?: string
  }) => Promise<void>
  latestAiRequestVersionRef: MutableRefObject<Record<string, number>>
  viewerProductSessionRef: ViewerProductSessionRef
  recentReplyCacheRef: RecentReplyCacheRef
}) {
  const {
    comment,
    commentContent,
    accountId,
    accountName,
    config,
    allComments,
    allReplies,
    provider,
    model,
    apiKeys,
    customBaseURL,
    addReply,
    markReplySent,
    handleError,
    ensureTrialSession,
    reportTrialUse,
    latestAiRequestVersionRef,
    viewerProductSessionRef,
    recentReplyCacheRef,
  } = params

  if (
    isAutoReplyHostNickname(comment.nick_name, accountName) ||
    config.blockList?.some(blockedName =>
      areSameAutoReplyViewerName(comment.nick_name, blockedName),
    )
  ) {
    return
  }

  switch (comment.msg_type) {
    case 'taobao_comment':
    case 'xiaohongshu_comment':
    case 'wechat_channel_live_msg':
    case 'comment': {
      if (!commentContent) {
        return
      }

      const keywordReplied = handleKeywordReply(comment, config, accountId, handleError)
      if (keywordReplied || !config.comment.aiReply.enable) {
        return
      }

      if (!apiKeys[provider]) {
        await ensureTrialSession('auto_reply')
      }

      await handleAutoReplyProductReplyFlow({
        accountId,
        comment: comment as CommentMessage,
        commentContent,
        config,
        allComments,
        allReplies,
        provider,
        model,
        apiKey: apiKeys[provider],
        customBaseURL,
        addReply,
        markReplySent,
        handleError,
        reportTrialUse,
        latestAiRequestVersionRef,
        viewerProductSessionRef,
        recentReplyCacheRef,
      })
      return
    }
    case 'live_order': {
      if (!config.live_order.options?.onlyReplyPaid || comment.order_status === '已付款') {
        sendConfiguredReply(accountId, config, comment, handleError)
      }
      return
    }
    default:
      sendConfiguredReply(accountId, config, comment, handleError)
  }
}

export function handleAutoReplyPinComment(params: {
  comment: Message
  commentContent: string
  accountId: string
  accountName?: string | string[] | null
  config: AutoReplyConfig
}) {
  const { comment, commentContent, accountId, accountName, config } = params

  if (comment.msg_type !== 'wechat_channel_live_msg' || !config.pinComment.enable) {
    return
  }
  if (!commentContent) {
    return
  }
  if (!config.pinComment.includeHost && isAutoReplyHostNickname(comment.nick_name, accountName)) {
    return
  }

  const pureTextContent = commentContent.replace(/\[[^\]]{1,3}\]/g, '')
  if (!config.pinComment.matchStr.some(str => pureTextContent.includes(str))) {
    return
  }

  void window.autoReplyAPI.pinComment({
    accountId,
    content: pureTextContent,
  })
}
