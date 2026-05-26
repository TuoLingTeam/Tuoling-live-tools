import type { AutoReplyAutoSendBlockedReason } from '@/lib/autoReply'
import type { ProductIntent, ProductQuestionType } from '@/lib/productKnowledge'

export interface ReplyPreview {
  id: string
  commentId: string
  replyContent: string
  replyFor: string
  time: string
  isSent: boolean
  source: 'ai' | 'product-kb' | 'manual'
  matchedSlotIndex?: number
  matchedTitle?: string
  questionType?: ProductQuestionType
  matchedFields?: string[]
  replyIntent?: ProductIntent | 'chat'
  factStatus?: 'grounded' | 'missing' | 'not-applicable'
  guardrailAction?: 'pass' | 'rewrite'
  guardrailReason?: string
  knowledgeMissReason?:
    | 'no-items'
    | 'not-product-query'
    | 'slot-not-found'
    | 'reference-expired'
    | 'keyword-not-found'
  wasDeduplicated?: boolean
  autoSendBlockedReason?: AutoReplyAutoSendBlockedReason
}

export type Message = LiveMessage
export type MessageType = Message['msg_type']
export type EventMessageType = Extract<
  MessageType,
  | 'room_enter'
  | 'room_like'
  | 'live_order'
  | 'subscribe_merchant_brand_vip'
  | 'room_follow'
  | 'ecom_fansclub_participate'
>
export type MessageOf<T extends MessageType> = Extract<Message, { msg_type: T }>
export type CommentMessage = MessageOf<Exclude<MessageType, EventMessageType>>

export type ListeningStatus = 'waiting' | 'listening' | 'stopped' | 'error'
