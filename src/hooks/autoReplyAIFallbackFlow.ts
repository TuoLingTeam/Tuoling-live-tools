import type { MutableRefObject } from 'react'
import { enforceAutoReplyLength } from '@/lib/autoReply'
import type { decideAutoReply } from '@/lib/autoReplyDecision'
import { tryProductKnowledgeReply } from '@/lib/productKnowledge'
import {
  type AddReply,
  cacheRecentReply,
  type RecentReplyCacheRef,
  type ReplyMetadata,
  shouldDeduplicateReplyPreview,
  updateViewerProductSession,
  type ViewerProductSessionRef,
} from './autoReplyCommentShared'
import { type AutoReplyErrorHandler, handleAIReply, sendMessage } from './autoReplyRuntime'
import type { CommentMessage, Message, ReplyPreview } from './autoReplyTypes'
import type { AIProvider } from './useAIChat'
import { getEffectiveAICredentials } from './useAITrial'
import { useAutoPopUpStore } from './useAutoPopUp'
import type { AutoReplyConfig } from './useAutoReplyConfig'

type AutoReplyDecisionResult = ReturnType<typeof decideAutoReply>

export async function handleAutoReplyAIFallbackFlow(params: {
  accountId: string
  comment: CommentMessage
  commentContent: string
  decision: AutoReplyDecisionResult
  config: AutoReplyConfig
  allComments: Message[]
  allReplies: ReplyPreview[]
  provider: AIProvider
  model: string
  apiKey: string
  customBaseURL: string
  addReply: AddReply
  markReplySent: (accountId: string, commentId: string) => void
  handleError: AutoReplyErrorHandler
  reportTrialUse: (params: {
    feature: 'chat' | 'auto_reply' | 'knowledge_draft'
    model?: string
  }) => Promise<void>
  latestAiRequestVersionRef: MutableRefObject<Record<string, number>>
  viewerProductSessionRef: ViewerProductSessionRef
  recentReplyCacheRef: RecentReplyCacheRef
}) {
  const {
    accountId,
    comment,
    commentContent,
    decision,
    config,
    allComments,
    allReplies,
    provider,
    model,
    apiKey,
    customBaseURL,
    addReply,
    markReplySent,
    handleError,
    reportTrialUse,
    latestAiRequestVersionRef,
    viewerProductSessionRef,
    recentReplyCacheRef,
  } = params
  const { productKnowledgeHit } = decision

  if (decision.mode === 'safe-fallback' && decision.replyContent) {
    const safeReply = enforceAutoReplyLength(decision.replyContent)
    const metadata: ReplyMetadata = {
      source: decision.diagnostics.source,
      matchedSlotIndex: productKnowledgeHit.slotIndex,
      replyIntent: decision.diagnostics.replyIntent,
      factStatus: decision.diagnostics.factStatus,
      guardrailAction: decision.diagnostics.guardrailAction,
      guardrailReason: decision.diagnostics.guardrailReason,
      knowledgeMissReason: decision.diagnostics.knowledgeMissReason,
    }

    if (
      shouldDeduplicateReplyPreview({
        accountId,
        nickname: comment.nick_name,
        replyContent: safeReply,
        recentReplyCacheRef,
      })
    ) {
      addReply(accountId, comment.msg_id, comment.nick_name, safeReply, {
        ...metadata,
        wasDeduplicated: true,
      })
      return
    }

    if (config.comment.aiReply.autoSend) {
      void sendMessage(accountId, safeReply, handleError).then(sent => {
        if (sent) {
          markReplySent(accountId, comment.msg_id)
        }
      })
    }

    cacheRecentReply({
      accountId,
      nickname: comment.nick_name,
      replyContent: safeReply,
      recentReplyCacheRef,
    })
    addReply(accountId, comment.msg_id, comment.nick_name, safeReply, metadata)
    return
  }

  const credentials = getEffectiveAICredentials({
    feature: 'auto_reply',
    userProvider: provider,
    userModel: model,
    userApiKey: apiKey,
    userCustomBaseURL: customBaseURL,
  })

  if (!credentials) {
    return
  }

  const requestKey = `${accountId}:${comment.nick_name}`
  latestAiRequestVersionRef.current[requestKey] =
    (latestAiRequestVersionRef.current[requestKey] ?? 0) + 1
  const requestVersion = latestAiRequestVersionRef.current[requestKey]

  handleAIReply(
    accountId,
    comment,
    allComments,
    allReplies,
    config,
    {
      provider: credentials.provider,
      model: credentials.model,
      apiKey: credentials.apiKey,
      customBaseURL: credentials.customBaseURL,
      conversationMode: decision.aiConversationMode,
    },
    (replyContent: string, isSent = false) => {
      if (latestAiRequestVersionRef.current[requestKey] !== requestVersion) {
        return
      }

      if (
        shouldDeduplicateReplyPreview({
          accountId,
          nickname: comment.nick_name,
          replyContent,
          recentReplyCacheRef,
        })
      ) {
        addReply(accountId, comment.msg_id, comment.nick_name, replyContent, {
          source: decision.diagnostics.source,
          matchedSlotIndex: productKnowledgeHit.slotIndex,
          replyIntent: decision.diagnostics.replyIntent,
          factStatus: decision.diagnostics.factStatus,
          guardrailAction: decision.diagnostics.guardrailAction,
          knowledgeMissReason: decision.diagnostics.knowledgeMissReason,
          wasDeduplicated: true,
        })
        return
      }

      cacheRecentReply({
        accountId,
        nickname: comment.nick_name,
        replyContent,
        recentReplyCacheRef,
      })

      addReply(
        accountId,
        comment.msg_id,
        comment.nick_name,
        replyContent,
        {
          source: decision.diagnostics.source,
          matchedSlotIndex: productKnowledgeHit.slotIndex,
          replyIntent: decision.diagnostics.replyIntent,
          factStatus: decision.diagnostics.factStatus,
          guardrailAction: decision.diagnostics.guardrailAction,
          knowledgeMissReason: decision.diagnostics.knowledgeMissReason,
        },
        isSent,
      )

      if (isSent) {
        const knowledgeHit = tryProductKnowledgeReply({
          comment: commentContent,
          items: useAutoPopUpStore.getState().contexts[accountId]?.config.goods ?? [],
        })
        if (knowledgeHit.hit) {
          updateViewerProductSession({
            accountId,
            nickname: comment.nick_name,
            slotIndex: knowledgeHit.slotIndex,
            viewerProductSessionRef,
          })
        }
      }
    },
    handleError,
  )

  if (credentials.credentialMode === 'trial') {
    await reportTrialUse({ feature: 'auto_reply', model: credentials.model })
  }
}
