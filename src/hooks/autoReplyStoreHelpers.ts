import { AUTO_REPLY } from '@/constants'
import type { ListeningStatus, Message, ReplyPreview } from './autoReplyTypes'

export interface AutoReplyContext {
  isRunning: boolean
  isListening: ListeningStatus
  lastStopReason?: string
  lastStoppedAt?: string
  lastStopDetail?: string
  replies: ReplyPreview[]
  comments: Message[]
  currentSessionId: string | null
  currentSessionStartedAt: string | null
  currentSessionEndedAt: string | null
  archivedSessionId: string | null
  historySessions: Array<{
    sessionId: string
    startedAt: string
    endedAt: string
    comments: Message[]
    replies: ReplyPreview[]
  }>
}

export const createDefaultAutoReplyContext = (): AutoReplyContext => ({
  isRunning: false,
  isListening: 'stopped',
  lastStopReason: undefined,
  lastStoppedAt: undefined,
  lastStopDetail: undefined,
  replies: [],
  comments: [],
  currentSessionId: null,
  currentSessionStartedAt: null,
  currentSessionEndedAt: null,
  archivedSessionId: null,
  historySessions: [],
})

export function serializeAutoReplyContext(savedContext: AutoReplyContext) {
  return {
    ...savedContext,
    isRunning: false,
    isListening: 'stopped' as ListeningStatus,
  }
}

export function restoreAutoReplyContext(savedContext: AutoReplyContext): AutoReplyContext {
  return {
    ...savedContext,
    isRunning: false,
    isListening: 'stopped',
    lastStopReason: savedContext.lastStopReason,
    lastStoppedAt: savedContext.lastStoppedAt,
    lastStopDetail: savedContext.lastStopDetail,
    currentSessionId: savedContext.currentSessionId ?? null,
    currentSessionStartedAt: savedContext.currentSessionStartedAt ?? null,
    currentSessionEndedAt: savedContext.currentSessionEndedAt ?? null,
    archivedSessionId: savedContext.archivedSessionId ?? null,
    historySessions: (savedContext.historySessions ?? []).slice(0, 50),
    comments: savedContext.comments.slice(0, AUTO_REPLY.MAX_COMMENTS),
    replies: savedContext.replies.slice(0, AUTO_REPLY.MAX_REPLIES),
  }
}

export function archiveCurrentSession(context: AutoReplyContext) {
  if (
    !context.currentSessionId ||
    context.archivedSessionId === context.currentSessionId ||
    (context.comments.length === 0 && context.replies.length === 0)
  ) {
    return
  }

  context.historySessions = [
    {
      sessionId: context.currentSessionId,
      startedAt: context.currentSessionStartedAt ?? new Date().toISOString(),
      endedAt: context.currentSessionEndedAt ?? new Date().toISOString(),
      comments: context.comments,
      replies: context.replies,
    },
    ...context.historySessions.filter(session => session.sessionId !== context.currentSessionId),
  ].slice(0, 50)
  context.archivedSessionId = context.currentSessionId
}

export function beginNewSessionIfNeeded(context: AutoReplyContext) {
  if (
    !context.currentSessionId ||
    context.archivedSessionId === context.currentSessionId ||
    (context.isListening === 'stopped' &&
      (context.comments.length > 0 || context.replies.length > 0))
  ) {
    context.currentSessionId = crypto.randomUUID()
    context.currentSessionStartedAt = new Date().toISOString()
    context.currentSessionEndedAt = null
    context.archivedSessionId = null
    context.comments = []
    context.replies = []
  }
}
