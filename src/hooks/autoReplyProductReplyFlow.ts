import type { MutableRefObject } from 'react'
import { enforceAutoReplyLength } from '@/lib/autoReply'
import { decideAutoReply } from '@/lib/autoReplyDecision'
import { validateGroundedProductReply } from '@/lib/productKnowledge'
import { handleAutoReplyAIFallbackFlow } from './autoReplyAIFallbackFlow'
import {
  type AddReply,
  cacheRecentReply,
  type RecentReplyCacheRef,
  type ReplyMetadata,
  shouldDeduplicateReplyPreview,
  updateViewerProductSession,
  type ViewerProductSessionRef,
} from './autoReplyCommentShared'
import {
  type AutoReplyErrorHandler,
  getAutoSendBlockedReasonForPreview,
  maybePolishProductKnowledgeReply,
  sendMessage,
  shouldAutoSendForAutoReplyMode,
} from './autoReplyRuntime'
import type { CommentMessage, Message, ReplyPreview } from './autoReplyTypes'
import type { AIProvider } from './useAIChat'
import { useAutoPopUpStore } from './useAutoPopUp'
import type { AutoReplyConfig } from './useAutoReplyConfig'

export async function handleAutoReplyProductReplyFlow(params: {
  accountId: string
  comment: CommentMessage
  commentContent: string
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

  const productKnowledgeItems = useAutoPopUpStore.getState().contexts[accountId]?.config.goods ?? []
  const decision = decideAutoReply({
    comment: commentContent,
    items: productKnowledgeItems,
    viewerSession: viewerProductSessionRef.current[`${accountId}:${comment.nick_name}`],
  })
  const { productKnowledgeHit } = decision

  if (productKnowledgeHit.shouldUpdateSession) {
    updateViewerProductSession({
      accountId,
      nickname: comment.nick_name,
      slotIndex: productKnowledgeHit.slotIndex,
      viewerProductSessionRef,
    })
  }

  if (decision.mode === 'product-kb' && decision.replyContent) {
    const matchedKnowledgeItem = productKnowledgeHit.item
    let guardrailAction: 'pass' | 'rewrite' = 'pass'
    let guardrailReason: string | undefined

    let finalReply =
      matchedKnowledgeItem && decision.shouldPolishWithAi
        ? await maybePolishProductKnowledgeReply({
            commentText: commentContent,
            templateReply: decision.replyContent,
            knowledgeItem: matchedKnowledgeItem,
            config,
            productPrompt: config.comment.aiReply.productPrompt,
            provider,
            model,
            apiKey,
            customBaseURL,
          })
        : decision.replyContent

    const guardedReply = validateGroundedProductReply({
      comment: commentContent,
      reply: finalReply,
      items: productKnowledgeItems,
      expectedItem: matchedKnowledgeItem,
    })
    if (!guardedReply.ok) {
      guardrailAction = 'rewrite'
      guardrailReason = guardedReply.reason
      finalReply = matchedKnowledgeItem ? decision.replyContent : guardedReply.safeReply
    }

    const guardedTemplateReply = validateGroundedProductReply({
      comment: commentContent,
      reply: finalReply,
      items: productKnowledgeItems,
      expectedItem: matchedKnowledgeItem,
    })
    if (!guardedTemplateReply.ok) {
      guardrailAction = 'rewrite'
      guardrailReason = guardedTemplateReply.reason
      finalReply = guardedTemplateReply.safeReply
    }

    const sendableReply = enforceAutoReplyLength(finalReply)
    const metadata: ReplyMetadata = {
      source: decision.diagnostics.source,
      matchedSlotIndex: productKnowledgeHit.slotIndex,
      matchedTitle: productKnowledgeHit.item?.title,
      questionType: decision.diagnostics.questionType,
      matchedFields: decision.diagnostics.matchedFields,
      replyIntent: decision.diagnostics.replyIntent,
      factStatus: decision.diagnostics.factStatus,
      guardrailAction,
      guardrailReason,
      autoSendBlockedReason: getAutoSendBlockedReasonForPreview({
        commentContent,
        replyContent: sendableReply,
      }),
    }

    if (
      shouldDeduplicateReplyPreview({
        accountId,
        nickname: comment.nick_name,
        replyContent: sendableReply,
        recentReplyCacheRef,
      })
    ) {
      addReply(accountId, comment.msg_id, comment.nick_name, sendableReply, {
        ...metadata,
        wasDeduplicated: true,
      })
      return
    }

    let isSent = false
    if (shouldAutoSendForAutoReplyMode(config, decision.mode) && !metadata.autoSendBlockedReason) {
      void sendMessage(accountId, sendableReply, handleError).then(sent => {
        if (sent) {
          markReplySent(accountId, comment.msg_id)
        }
      })
      isSent = false
    }

    cacheRecentReply({
      accountId,
      nickname: comment.nick_name,
      replyContent: sendableReply,
      recentReplyCacheRef,
    })
    addReply(accountId, comment.msg_id, comment.nick_name, sendableReply, metadata, isSent)
    return
  }

  await handleAutoReplyAIFallbackFlow({
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
  })
}
