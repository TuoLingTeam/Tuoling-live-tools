import { useMemoizedFn } from 'ahooks'
import { useEffect, useRef } from 'react'
import { AUTO_REPLY } from '@/constants'
import type { ViewerProductSession } from '@/lib/productKnowledge'
import { useIsAuthenticated, useUser } from '@/stores/authStore'
import { handleAutoReplyPinComment, processAutoReplyComment } from './autoReplyCommentFlow'
import { isPersistableAutoReplyViewerComment } from './autoReplyCommentShared'
import { useAutoReplyStore } from './autoReplyStore'
import { createDefaultAutoReplyContext } from './autoReplyStoreHelpers'
import type { ListeningStatus, Message } from './autoReplyTypes'
import { useAccounts } from './useAccounts'
import { useAIChatStore } from './useAIChat'
import { useAITrialStore } from './useAITrial'
import { resolveAutoReplyConfigForAccount, useAutoReplyConfigStore } from './useAutoReplyConfig'
import { useErrorHandler } from './useErrorHandler'
import { useCurrentLiveControl, useLiveControlStore } from './useLiveControl'
import { useLiveStatsStore } from './useLiveStats'

export { getAISharedConfig } from './autoReplyRuntime'
export { useAutoReplyStore } from './autoReplyStore'
export type { EventMessageType, Message, MessageOf } from './autoReplyTypes'

function getAutoReplyOperatorNamesForAccount(accountId: string) {
  const liveAccountName = useLiveControlStore.getState().contexts[accountId]?.accountName
  const configuredAccountName = useAccounts
    .getState()
    .accounts.find(account => account.id === accountId)?.name

  return [liveAccountName, configuredAccountName].filter((name): name is string =>
    Boolean(name?.trim()),
  )
}

export function getAutoReplyProcessingConfigForAccount(accountId: string) {
  return resolveAutoReplyConfigForAccount(
    accountId,
    useAutoReplyConfigStore.getState().contexts[accountId]?.config,
  )
}

export function useAutoReply() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const user = useUser()
  const isAuthenticated = useIsAuthenticated()
  const defaultContextRef = useRef(createDefaultAutoReplyContext())
  const context = useAutoReplyStore(
    state => state.contexts[currentAccountId] ?? defaultContextRef.current,
  )
  const addComments = useAutoReplyStore(state => state.addComments)
  const addReply = useAutoReplyStore(state => state.addReply)
  const markReplySent = useAutoReplyStore(state => state.markReplySent)
  const setIsRunning = useAutoReplyStore(state => state.setIsRunning)
  const setIsListening = useAutoReplyStore(state => state.setIsListening)
  const removeReply = useAutoReplyStore(state => state.removeReply)
  const clearHistory = useAutoReplyStore(state => state.clearHistory)
  const syncLiveSession = useAutoReplyStore(state => state.syncLiveSession)
  const provider = useAIChatStore(state => state.config.provider)
  const model = useAIChatStore(state => state.config.model)
  const apiKeys = useAIChatStore(state => state.apiKeys)
  const customBaseURL = useAIChatStore(state => state.customBaseURL)
  const ensureTrialSession = useAITrialStore(state => state.ensureSession)
  const reportTrialUse = useAITrialStore(state => state.reportUse)
  const { handleError } = useErrorHandler()
  const { ensureContextLoaded, loadUserContexts } = useAutoReplyStore()

  const {
    isListening,
    lastStopReason,
    lastStoppedAt,
    lastStopDetail,
    comments,
    replies,
    historySessions,
    currentSessionId,
    currentSessionStartedAt,
    currentSessionEndedAt,
  } = context
  const liveSessionId = useCurrentLiveControl(ctx => ctx.liveSessionId)
  const liveSessionStartedAt = useCurrentLiveControl(ctx => ctx.liveSessionStartedAt)
  const liveSessionEndedAt = useCurrentLiveControl(ctx => ctx.liveSessionEndedAt)
  const latestAiRequestVersionRef = useRef<Record<string, number>>({})
  const viewerProductSessionRef = useRef<Record<string, ViewerProductSession>>({})
  const recentReplyCacheRef = useRef<Record<string, { content: string; at: number }>>({})

  useEffect(() => {
    if (currentAccountId && user?.id) {
      const state = useAutoReplyStore.getState()
      if (!state.contexts[currentAccountId]) {
        ensureContextLoaded(user.id, currentAccountId)
      }
    }
  }, [currentAccountId, user?.id, ensureContextLoaded])

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const state = useAutoReplyStore.getState()
      if (state.currentUserId !== user.id || Object.keys(state.contexts).length === 0) {
        loadUserContexts(user.id)
      }
    }
  }, [isAuthenticated, user?.id, loadUserContexts])

  useEffect(() => {
    syncLiveSession(currentAccountId, {
      sessionId: liveSessionId,
      startedAt: liveSessionStartedAt,
      endedAt: liveSessionEndedAt,
    })
  }, [currentAccountId, liveSessionEndedAt, liveSessionId, liveSessionStartedAt, syncLiveSession])

  const handleComments = useMemoizedFn((incomingComments: Message[], accountId: string) => {
    if (incomingComments.length === 0) {
      return
    }

    const currentContext =
      useAutoReplyStore.getState().contexts[accountId] || createDefaultAutoReplyContext()
    const {
      isRunning,
      isListening: autoReplyListening,
      comments: allComments,
      replies: allReplies,
    } = currentContext
    const scopedOperatorNames = getAutoReplyOperatorNamesForAccount(accountId)
    const accountConfig = getAutoReplyProcessingConfigForAccount(accountId)

    // 只在监听状态时添加评论到列表
    if (autoReplyListening === 'listening') {
      addComments(accountId, incomingComments, scopedOperatorNames)
    }

    // 同步到 LiveStats 统计模块（仅在监听时）
    const liveStatsContext = useLiveStatsStore.getState().contexts[accountId]
    if (liveStatsContext?.isListening) {
      useLiveStatsStore.getState().handleMessages(accountId, incomingComments)
    }

    if (!isRunning) {
      return
    }

    // 检查前置条件：如果连接已断开，停止处理评论
    // 获取对应账号的连接状态
    const liveControlState = useLiveControlStore.getState()
    const accountConnectState = liveControlState.contexts[accountId]?.connectState
    const streamState = liveControlState.contexts[accountId]?.streamState
    if (!accountConnectState || accountConnectState.status !== 'connected') {
      console.log(
        `[TaskGate] Comment received but connection is ${accountConnectState?.status || 'unknown'} for account ${accountId}, ignoring`,
      )
      return
    }

    // 检查直播状态：未开播时不处理自动回复
    if (streamState !== 'live') {
      console.log(
        `[TaskGate] Comment received but stream is not live (state: ${streamState}) for account ${accountId}, ignoring`,
      )
      return
    }

    let rollingComments = allComments
    for (const comment of incomingComments) {
      const commentContent =
        'content' in comment && typeof comment.content === 'string' ? comment.content.trim() : ''

      void processAutoReplyComment({
        comment,
        commentContent,
        accountId,
        accountName: scopedOperatorNames,
        config: accountConfig,
        allComments: rollingComments,
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
      })

      handleAutoReplyPinComment({
        comment,
        commentContent,
        accountId,
        accountName: scopedOperatorNames,
        config: accountConfig,
      })

      if (
        autoReplyListening === 'listening' &&
        isPersistableAutoReplyViewerComment(comment, scopedOperatorNames)
      ) {
        rollingComments = [{ ...comment }, ...rollingComments].slice(0, AUTO_REPLY.MAX_COMMENTS)
      }
    }
  })

  const handleComment = useMemoizedFn((comment: Message, accountId: string) => {
    handleComments([comment], accountId)
  })

  // 【Phase 2A】绿点只基于真实运行态：isListening === 'listening'
  const isEffectivelyRunning = isListening === 'listening'

  return {
    // 当前账户的状态
    // 【Phase 2A】isRunning 对外暴露为 isEffectivelyRunning，绿点只基于真实运行态
    isRunning: isEffectivelyRunning,
    isListening,
    lastStopReason,
    lastStoppedAt,
    lastStopDetail,
    comments, // 当前账户的评论
    replies, // 当前账户的回复
    historySessions,
    currentSessionId,
    currentSessionStartedAt,
    currentSessionEndedAt,

    // Actions (绑定到当前账户)
    handleComment,
    handleComments,
    // 【Phase 2A】内部状态设置保持原样，供任务内部使用
    setIsRunning: (running: boolean) => setIsRunning(currentAccountId, running),
    setIsListening: (listening: ListeningStatus) => setIsListening(currentAccountId, listening),
    markReplySent: (commentId: string) => markReplySent(currentAccountId, commentId),
    removeReply: (commentId: string) => removeReply(currentAccountId, commentId),
    clearHistory: () => clearHistory(currentAccountId),
  }
}
