import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { AUTO_REPLY } from '@/constants'
import { getAutoReplyDisplayName } from '@/lib/autoReplyIdentity'
import { EVENTS, eventEmitter } from '@/utils/events'
import {
  loadAccountScopedContexts,
  loadSingleAccountScopedContext,
  persistAccountScopedContext,
  persistAllAccountScopedContexts,
  removeAccountScopedContext,
  runWhenAccountsReady,
} from './accountScopedContextStorage'
import { isPersistableAutoReplyViewerComment } from './autoReplyCommentShared'
import {
  type AutoReplyContext,
  archiveCurrentSession,
  beginNewSessionIfNeeded,
  createDefaultAutoReplyContext,
  restoreAutoReplyContext,
  serializeAutoReplyContext,
} from './autoReplyStoreHelpers'
import type { ListeningStatus, Message, ReplyPreview } from './autoReplyTypes'

interface AutoReplyState {
  contexts: Record<string, AutoReplyContext>
  currentUserId: string | null
}

interface AutoReplyAction {
  setIsRunning: (accountId: string, isRunning: boolean) => void
  setIsListening: (accountId: string, isListening: ListeningStatus) => void
  addComment: (accountId: string, comment: Message, operatorName?: string | string[] | null) => void
  addComments: (
    accountId: string,
    comments: Message[],
    operatorName?: string | string[] | null,
  ) => void
  addReply: (
    accountId: string,
    commentId: string,
    nickname: string,
    content: string,
    metadata?: Partial<
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
    >,
    isSent?: boolean,
  ) => void
  markReplySent: (accountId: string, commentId: string) => void
  removeReply: (accountId: string, commentId: string) => void
  clearHistory: (accountId: string) => void
  recordStopAudit: (
    accountId: string,
    payload: { reason: string; detail?: string; at?: string },
  ) => void
  syncLiveSession: (
    accountId: string,
    session: { sessionId: string | null; startedAt: string | null; endedAt: string | null },
  ) => void
  ensureContextLoaded: (userId: string, accountId: string) => void
  loadUserContexts: (userId: string) => void
  resetAllContexts: () => void
}

export type AutoReplyStore = AutoReplyState & AutoReplyAction

export const useAutoReplyStore = create<AutoReplyStore>()(
  immer((set, get) => {
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
        removeAccountScopedContext(
          'auto-reply-history',
          get().currentUserId,
          accountId,
          '[AutoReply]',
        )
      })
    })

    const ensureContext = (state: AutoReplyState, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = createDefaultAutoReplyContext()
      }
      return state.contexts[accountId]
    }

    const saveToStorage = (accountId: string, context: AutoReplyContext) => {
      persistAccountScopedContext({
        namespace: 'auto-reply-history',
        userId: get().currentUserId,
        accountId,
        context,
        logPrefix: '[AutoReply]',
        serialize: serializeAutoReplyContext,
      })
    }

    return {
      contexts: {},
      currentUserId: null,
      setIsRunning: (accountId, isRunning) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isRunning = isRunning
          saveToStorage(accountId, context)
        }),
      setIsListening: (accountId, isListening) =>
        set(state => {
          const context = ensureContext(state, accountId)
          if (isListening === 'listening') {
            beginNewSessionIfNeeded(context)
          } else if (context.isListening === 'listening' && isListening === 'stopped') {
            archiveCurrentSession(context)
          }
          context.isListening = isListening
          saveToStorage(accountId, context)
        }),
      addComment: (accountId, comment, operatorName) =>
        set(state => {
          if (!isPersistableAutoReplyViewerComment(comment, operatorName)) return
          const context = ensureContext(state, accountId)
          context.comments = [
            { ...comment },
            ...context.comments.filter(item =>
              isPersistableAutoReplyViewerComment(item, operatorName),
            ),
          ].slice(0, AUTO_REPLY.MAX_COMMENTS)
          saveToStorage(accountId, context)
        }),
      addComments: (accountId, comments, operatorName) => {
        const viewerComments = comments.filter(comment =>
          isPersistableAutoReplyViewerComment(comment, operatorName),
        )
        if (viewerComments.length === 0) {
          return
        }

        set(state => {
          const context = ensureContext(state, accountId)
          const newestFirst = viewerComments
            .slice()
            .reverse()
            .map(comment => ({ ...comment }))
          context.comments = [
            ...newestFirst,
            ...context.comments.filter(item =>
              isPersistableAutoReplyViewerComment(item, operatorName),
            ),
          ].slice(0, AUTO_REPLY.MAX_COMMENTS)
          saveToStorage(accountId, context)
        })
      },
      addReply: (accountId, commentId, nickname, content, metadata, isSent = false) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.replies = [
            {
              id: crypto.randomUUID(),
              commentId,
              replyContent: content,
              replyFor: getAutoReplyDisplayName(nickname),
              time: new Date().toISOString(),
              isSent,
              source: metadata?.source ?? 'ai',
              matchedSlotIndex: metadata?.matchedSlotIndex,
              matchedTitle: metadata?.matchedTitle,
              questionType: metadata?.questionType,
              matchedFields: metadata?.matchedFields,
              replyIntent: metadata?.replyIntent,
              factStatus: metadata?.factStatus,
              guardrailAction: metadata?.guardrailAction,
              guardrailReason: metadata?.guardrailReason,
              knowledgeMissReason: metadata?.knowledgeMissReason,
              wasDeduplicated: metadata?.wasDeduplicated,
              autoSendBlockedReason: metadata?.autoSendBlockedReason,
            },
            // 只替换同一条评论的历史预览，不再清空同一用户其他未发送回复。
            // 否则像“5号链接多久发货”这类被拦截的高风险预览，会被该用户下一条回复意外顶掉。
            ...context.replies.filter(reply => reply.commentId !== commentId),
          ].slice(0, AUTO_REPLY.MAX_REPLIES)
          saveToStorage(accountId, context)
        }),
      markReplySent: (accountId, commentId) =>
        set(state => {
          const context = ensureContext(state, accountId)
          const reply = context.replies.find(item => item.commentId === commentId)
          if (reply) {
            reply.isSent = true
            saveToStorage(accountId, context)
          }
        }),
      removeReply: (accountId, commentId) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.replies = context.replies.filter(reply => reply.commentId !== commentId)
          saveToStorage(accountId, context)
        }),
      clearHistory: accountId =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.comments = []
          context.replies = []
          context.historySessions = []
          context.currentSessionId = null
          context.currentSessionStartedAt = null
          context.currentSessionEndedAt = null
          context.archivedSessionId = null
          saveToStorage(accountId, context)
        }),
      recordStopAudit: (accountId, payload) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.lastStopReason = payload.reason
          context.lastStopDetail = payload.detail
          context.lastStoppedAt = payload.at ?? new Date().toISOString()
          saveToStorage(accountId, context)
        }),
      syncLiveSession: (accountId, session) =>
        set(state => {
          const context = ensureContext(state, accountId)
          if (!session.sessionId) {
            if (session.endedAt && context.currentSessionId) {
              context.currentSessionEndedAt = session.endedAt
              saveToStorage(accountId, context)
            }
            return
          }

          if (context.currentSessionId && context.currentSessionId !== session.sessionId) {
            archiveCurrentSession(context)
            context.comments = []
            context.replies = []
            context.archivedSessionId = null
          }

          context.currentSessionId = session.sessionId
          context.currentSessionStartedAt = session.startedAt
          context.currentSessionEndedAt = session.endedAt
          saveToStorage(accountId, context)
        }),
      ensureContextLoaded: (userId, accountId) => {
        const loadContext = () => {
          set(state => {
            if (state.contexts[accountId]) {
              console.log(`[AutoReply] Context already loaded for account ${accountId}, skip`)
              return
            }

            state.currentUserId = userId
            const restored = loadSingleAccountScopedContext<AutoReplyContext, 'auto-reply-history'>(
              {
                namespace: 'auto-reply-history',
                userId,
                accountId,
                restoreContext: restoreAutoReplyContext,
              },
            )

            console.log(
              `[AutoReply] Hydrating single account context for ${accountId}: ${restored ? 'restored' : 'created-default'}`,
            )
            state.contexts[accountId] = restored ?? createDefaultAutoReplyContext()
          })
        }

        runWhenAccountsReady(loadContext)
      },
      loadUserContexts: (userId: string) => {
        const loadContexts = () => {
          set(state => {
            const prevContexts: Record<string, AutoReplyContext> =
              state.currentUserId === userId ? state.contexts : {}
            state.currentUserId = userId
            const loadedContexts: Record<string, AutoReplyContext> = loadAccountScopedContexts({
              namespace: 'auto-reply-history',
              userId,
              restoreContext: restoreAutoReplyContext,
            })

            console.log(
              `[AutoReply] Loading all contexts for user ${userId}: loaded=${Object.keys(loadedContexts).length}, prev=${Object.keys(prevContexts).length}`,
            )
            state.contexts = loadedContexts

            for (const [accountId, existingContext] of Object.entries(prevContexts)) {
              if (!existingContext) continue

              const hasActiveRuntimeState =
                existingContext.isRunning || existingContext.isListening !== 'stopped'

              if (hasActiveRuntimeState) {
                console.log(
                  `[AutoReply] Preserving in-memory context for ${accountId}: isRunning=${existingContext.isRunning}, isListening=${existingContext.isListening}`,
                )
                state.contexts[accountId] = existingContext
              } else if (!state.contexts[accountId]) {
                state.contexts[accountId] = existingContext
              }
            }
          })
        }

        runWhenAccountsReady(loadContexts)
      },
      resetAllContexts: () => {
        set(state => {
          persistAllAccountScopedContexts({
            namespace: 'auto-reply-history',
            userId: state.currentUserId,
            contexts: state.contexts,
            logPrefix: '[AutoReply]',
            serialize: serializeAutoReplyContext,
          })
          state.contexts = {}
          state.currentUserId = null
        })
      },
    }
  }),
)
