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

const PERSISTED_AUTO_REPLY_ACTIVE_ITEM_LIMIT = 100
const PERSISTED_AUTO_REPLY_HISTORY_SESSION_LIMIT = 10
const PERSISTED_AUTO_REPLY_HISTORY_ITEM_LIMIT = 50
export const AUTO_REPLY_HISTORY_RETENTION_DAYS = 7
const AUTO_REPLY_HISTORY_RETENTION_MS = AUTO_REPLY_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

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

function parsePersistedTimestamp(value?: string | null) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function isWithinAutoReplyHistoryRetention(value: string | null | undefined, nowMs: number) {
  const timestamp = parsePersistedTimestamp(value)
  return timestamp === null || nowMs - timestamp <= AUTO_REPLY_HISTORY_RETENTION_MS
}

function filterRecentHistoryItems<T extends { time?: string }>(
  items: T[],
  sessionStartedAt: string | null | undefined,
  nowMs: number,
) {
  return items.filter(item => {
    const timestamp =
      parsePersistedTimestamp(item.time) ?? parsePersistedTimestamp(sessionStartedAt)
    return timestamp === null || nowMs - timestamp <= AUTO_REPLY_HISTORY_RETENTION_MS
  })
}

export function pruneAutoReplyContextHistory(
  context: AutoReplyContext,
  nowMs = Date.now(),
): AutoReplyContext {
  return {
    ...context,
    comments: filterRecentHistoryItems(
      context.comments ?? [],
      context.currentSessionStartedAt,
      nowMs,
    ),
    replies: filterRecentHistoryItems(
      context.replies ?? [],
      context.currentSessionStartedAt,
      nowMs,
    ),
    historySessions: (context.historySessions ?? [])
      .filter(session =>
        isWithinAutoReplyHistoryRetention(session.endedAt ?? session.startedAt, nowMs),
      )
      .map(session => ({
        ...session,
        comments: filterRecentHistoryItems(session.comments ?? [], session.startedAt, nowMs),
        replies: filterRecentHistoryItems(session.replies ?? [], session.startedAt, nowMs),
      }))
      .filter(session => session.comments.length > 0 || session.replies.length > 0),
  }
}

export function serializeAutoReplyContext(savedContext: AutoReplyContext) {
  const prunedContext = pruneAutoReplyContextHistory(savedContext)

  return {
    ...prunedContext,
    isRunning: false,
    isListening: 'stopped' as ListeningStatus,
    comments: prunedContext.comments.slice(0, PERSISTED_AUTO_REPLY_ACTIVE_ITEM_LIMIT),
    replies: prunedContext.replies.slice(0, PERSISTED_AUTO_REPLY_ACTIVE_ITEM_LIMIT),
    historySessions: (prunedContext.historySessions ?? [])
      .slice(0, PERSISTED_AUTO_REPLY_HISTORY_SESSION_LIMIT)
      .map(session => ({
        ...session,
        comments: session.comments.slice(0, PERSISTED_AUTO_REPLY_HISTORY_ITEM_LIMIT),
        replies: session.replies.slice(0, PERSISTED_AUTO_REPLY_HISTORY_ITEM_LIMIT),
      })),
  }
}

export function restoreAutoReplyContext(savedContext: AutoReplyContext): AutoReplyContext {
  const prunedContext = pruneAutoReplyContextHistory(savedContext)

  return {
    ...prunedContext,
    isRunning: false,
    isListening: 'stopped',
    lastStopReason: prunedContext.lastStopReason,
    lastStoppedAt: prunedContext.lastStoppedAt,
    lastStopDetail: prunedContext.lastStopDetail,
    currentSessionId: prunedContext.currentSessionId ?? null,
    currentSessionStartedAt: prunedContext.currentSessionStartedAt ?? null,
    currentSessionEndedAt: prunedContext.currentSessionEndedAt ?? null,
    archivedSessionId: prunedContext.archivedSessionId ?? null,
    historySessions: (prunedContext.historySessions ?? []).slice(0, 50),
    comments: prunedContext.comments.slice(0, AUTO_REPLY.MAX_COMMENTS),
    replies: prunedContext.replies.slice(0, AUTO_REPLY.MAX_REPLIES),
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
  context.historySessions = pruneAutoReplyContextHistory(context).historySessions
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
