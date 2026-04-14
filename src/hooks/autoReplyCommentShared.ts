import type { MutableRefObject } from 'react'
import { shouldSkipDuplicateReply } from '@/lib/autoReply'
import type { ViewerProductSession } from '@/lib/productKnowledge'
import type { ReplyPreview } from './autoReplyTypes'

export type ReplyMetadata = Partial<
  Pick<
    ReplyPreview,
    | 'source'
    | 'matchedSlotIndex'
    | 'matchedTitle'
    | 'questionType'
    | 'matchedFields'
    | 'replyIntent'
    | 'factStatus'
    | 'guardrailAction'
    | 'guardrailReason'
    | 'knowledgeMissReason'
    | 'wasDeduplicated'
    | 'autoSendBlockedReason'
  >
>

export type AddReply = (
  accountId: string,
  commentId: string,
  nickname: string,
  content: string,
  metadata?: ReplyMetadata,
  isSent?: boolean,
) => void

export type RecentReplyCacheRef = MutableRefObject<Record<string, { content: string; at: number }>>

export type ViewerProductSessionRef = MutableRefObject<Record<string, ViewerProductSession>>

export function buildRecentReplyKey(accountId: string, nickname: string) {
  return `${accountId}:${nickname}`
}

export function shouldDeduplicateReplyPreview(params: {
  accountId: string
  nickname: string
  replyContent: string
  recentReplyCacheRef: RecentReplyCacheRef
}) {
  const { accountId, nickname, replyContent, recentReplyCacheRef } = params
  const recentReplyKey = buildRecentReplyKey(accountId, nickname)
  const lastReply = recentReplyCacheRef.current[recentReplyKey]

  return shouldSkipDuplicateReply({
    replyContent,
    lastReplyContent: lastReply?.content,
    lastReplyAt: lastReply?.at,
  })
}

export function cacheRecentReply(params: {
  accountId: string
  nickname: string
  replyContent: string
  recentReplyCacheRef: RecentReplyCacheRef
}) {
  const { accountId, nickname, replyContent, recentReplyCacheRef } = params
  recentReplyCacheRef.current[buildRecentReplyKey(accountId, nickname)] = {
    content: replyContent,
    at: Date.now(),
  }
}

export function updateViewerProductSession(params: {
  accountId: string
  nickname: string
  slotIndex?: number
  viewerProductSessionRef: ViewerProductSessionRef
}) {
  const { accountId, nickname, slotIndex, viewerProductSessionRef } = params
  if (!slotIndex) {
    return
  }

  viewerProductSessionRef.current[buildRecentReplyKey(accountId, nickname)] = {
    slotIndex,
    updatedAt: Date.now(),
  }
}
