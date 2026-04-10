/**
 * 账号状态管理 Hook
 * 事件驱动聚合所有账号的连接与任务运行状态
 */

import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  AccountStatusMap,
  AccountTaskState,
  ConnectionStatus,
  TaskStatusInfo,
} from '@/types/account-status'
import { taskStateManager } from '@/utils/TaskStateManager'
import { useAccounts } from './useAccounts'
import { useAutoMessageStore } from './useAutoMessage'
import { useAutoPopUpStore } from './useAutoPopUp'
import { useAutoReplyStore } from './useAutoReply'
import { useLiveControlStore } from './useLiveControl'
import { useLiveStatsStore } from './useLiveStats'

interface AccountStatusStore {
  statusMap: AccountStatusMap
  updateAccountStatus: (accountId: string, state: Partial<AccountTaskState>) => void
  setStatusMap: (map: AccountStatusMap) => void
  getAccountStatus: (accountId: string) => AccountTaskState | undefined
  removeAccountStatus: (accountId: string) => void
}

const useAccountStatusStore = create<AccountStatusStore>()(
  subscribeWithSelector((set, get) => ({
    statusMap: {},

    updateAccountStatus: (accountId, state) => {
      set(prev => ({
        statusMap: {
          ...prev.statusMap,
          [accountId]: {
            ...prev.statusMap[accountId],
            accountId,
            ...state,
            lastUpdated: Date.now(),
          } as AccountTaskState,
        },
      }))
    },

    setStatusMap: map => set({ statusMap: map }),

    getAccountStatus: accountId => get().statusMap[accountId],

    removeAccountStatus: accountId => {
      set(prev => {
        const newMap = { ...prev.statusMap }
        delete newMap[accountId]
        return { statusMap: newMap }
      })
    },
  })),
)

type Unsubscribe = () => void

let syncRefCount = 0
let syncCleanups: Unsubscribe[] = []

type TaskSignal = {
  autoMessageRunning: boolean
  autoPopUpRunning: boolean
  autoReplyRunning: boolean
  autoReplyListening: string
  liveStatsListening: boolean
}

type TaskSignalEntry = [string, TaskSignal]
type LiveControlSignalEntry = [string, ConnectionStatus]

function getConnectionStatus(accountId: string): ConnectionStatus {
  const connectState = useLiveControlStore.getState().contexts[accountId]?.connectState
  switch (connectState?.status) {
    case 'connecting':
      return 'connecting'
    case 'reconnecting':
      return 'reconnecting'
    case 'connected':
      return 'connected'
    case 'disconnected':
      return 'disconnected'
    case 'error':
      return 'error'
    default:
      return 'disconnected'
  }
}

function getTaskStatuses(accountId: string): TaskStatusInfo[] {
  return taskStateManager
    .getTaskStates(accountId)
    .filter(task => task.type !== 'sub-account')
    .map(task => ({
      taskId:
        task.type === 'auto-message'
          ? 'autoSpeak'
          : task.type === 'auto-popup'
            ? 'autoPopup'
            : task.type === 'auto-reply'
              ? 'autoReply'
              : 'liveStats',
      status: task.isRunning ? 'running' : 'idle',
    }))
}

function syncAccountStatus(accountId: string): void {
  if (!accountId) return

  useAccountStatusStore.getState().updateAccountStatus(accountId, {
    accountId,
    connectionStatus: getConnectionStatus(accountId),
    tasks: getTaskStatuses(accountId),
  })
}

function syncAllAccountStatuses(): void {
  const accounts = useAccounts.getState().accounts
  accounts.forEach(account => syncAccountStatus(account.id))
}

function pickTaskSignalsFromContexts(
  autoMessageContexts: Record<string, { isRunning?: boolean }>,
  autoPopUpContexts: Record<string, { isRunning?: boolean }>,
  autoReplyContexts: Record<string, { isRunning?: boolean; isListening?: string }>,
  liveStatsContexts: Record<string, { isListening?: boolean }>,
): TaskSignalEntry[] {
  const accountIds = new Set([
    ...Object.keys(autoMessageContexts),
    ...Object.keys(autoPopUpContexts),
    ...Object.keys(autoReplyContexts),
    ...Object.keys(liveStatsContexts),
  ])

  const entries: TaskSignalEntry[] = [...accountIds].map(accountId => [
    accountId,
    {
      autoMessageRunning: autoMessageContexts[accountId]?.isRunning ?? false,
      autoPopUpRunning: autoPopUpContexts[accountId]?.isRunning ?? false,
      autoReplyRunning: autoReplyContexts[accountId]?.isRunning ?? false,
      autoReplyListening: autoReplyContexts[accountId]?.isListening ?? 'stopped',
      liveStatsListening: liveStatsContexts[accountId]?.isListening ?? false,
    },
  ])

  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries
}

function pickLiveControlSignals(
  contexts: Record<string, { connectState?: { status?: ConnectionStatus } }>,
): LiveControlSignalEntry[] {
  return Object.entries(contexts)
    .filter(([accountId]) => accountId !== 'default')
    .map(
      ([accountId, context]) =>
        [accountId, context.connectState?.status ?? 'disconnected'] as LiveControlSignalEntry,
    )
}

function syncChangedKeys<T>(
  prevEntries: Array<[string, T]>,
  nextEntries: Array<[string, T]>,
  onChanged: (accountId: string) => void,
) {
  const prevMap = new Map(prevEntries)
  const nextMap = new Map(nextEntries)
  const accountIds = new Set([...prevMap.keys(), ...nextMap.keys()])

  for (const accountId of accountIds) {
    const prevValue = prevMap.get(accountId)
    const nextValue = nextMap.get(accountId)
    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      onChanged(accountId)
    }
  }
}

export function ensureAccountStatusSync(): void {
  syncRefCount += 1
  if (syncRefCount > 1) {
    return
  }

  syncAllAccountStatuses()

  syncCleanups.push(
    useAccounts.subscribe((state, prevState) => {
      const nextIds = state.accounts.map(account => account.id)
      const prevIds = prevState.accounts.map(account => account.id)
      const nextSet = new Set(nextIds)
      const prevSet = new Set(prevIds)

      for (const accountId of nextSet) {
        if (!prevSet.has(accountId)) {
          syncAccountStatus(accountId)
        }
      }

      for (const accountId of prevSet) {
        if (!nextSet.has(accountId)) {
          useAccountStatusStore.getState().removeAccountStatus(accountId)
        }
      }
    }),
  )

  syncCleanups.push(
    useLiveControlStore.subscribe((state, prevState) => {
      const next = pickLiveControlSignals(state.contexts)
      const prev = pickLiveControlSignals(prevState.contexts)
      syncChangedKeys(prev, next, syncAccountStatus)
    }),
  )

  syncCleanups.push(
    useAutoMessageStore.subscribe((state, prevState) => {
      const next = pickTaskSignalsFromContexts(
        state.contexts,
        useAutoPopUpStore.getState().contexts,
        useAutoReplyStore.getState().contexts,
        useLiveStatsStore.getState().contexts,
      )
      const prev = pickTaskSignalsFromContexts(
        prevState.contexts,
        useAutoPopUpStore.getState().contexts,
        useAutoReplyStore.getState().contexts,
        useLiveStatsStore.getState().contexts,
      )
      syncChangedKeys(prev, next, syncAccountStatus)
    }),
  )

  syncCleanups.push(
    useAutoPopUpStore.subscribe((state, prevState) => {
      const next = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        state.contexts,
        useAutoReplyStore.getState().contexts,
        useLiveStatsStore.getState().contexts,
      )
      const prev = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        prevState.contexts,
        useAutoReplyStore.getState().contexts,
        useLiveStatsStore.getState().contexts,
      )
      syncChangedKeys(prev, next, syncAccountStatus)
    }),
  )

  syncCleanups.push(
    useAutoReplyStore.subscribe((state, prevState) => {
      const next = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        useAutoPopUpStore.getState().contexts,
        state.contexts,
        useLiveStatsStore.getState().contexts,
      )
      const prev = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        useAutoPopUpStore.getState().contexts,
        prevState.contexts,
        useLiveStatsStore.getState().contexts,
      )
      syncChangedKeys(prev, next, syncAccountStatus)
    }),
  )

  syncCleanups.push(
    useLiveStatsStore.subscribe((state, prevState) => {
      const next = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        useAutoPopUpStore.getState().contexts,
        useAutoReplyStore.getState().contexts,
        state.contexts,
      )
      const prev = pickTaskSignalsFromContexts(
        useAutoMessageStore.getState().contexts,
        useAutoPopUpStore.getState().contexts,
        useAutoReplyStore.getState().contexts,
        prevState.contexts,
      )
      syncChangedKeys(prev, next, syncAccountStatus)
    }),
  )
}

export function releaseAccountStatusSync(): void {
  syncRefCount = Math.max(0, syncRefCount - 1)
  if (syncRefCount > 0) {
    return
  }

  for (const cleanup of syncCleanups) {
    cleanup()
  }
  syncCleanups = []
}

export function resetAccountStatusSyncForTests(): void {
  syncRefCount = 0
  for (const cleanup of syncCleanups) {
    cleanup()
  }
  syncCleanups = []
  useAccountStatusStore.setState({ statusMap: {} })
}

export function useAccountStatus() {
  const statusMap = useAccountStatusStore(state => state.statusMap)
  const removeAccountStatus = useAccountStatusStore(state => state.removeAccountStatus)

  useEffect(() => {
    ensureAccountStatusSync()
    return () => {
      releaseAccountStatusSync()
    }
  }, [])

  const refreshAccountStatus = useCallback((accountId: string) => {
    syncAccountStatus(accountId)
  }, [])

  const refreshAllStatus = useCallback(() => {
    syncAllAccountStatuses()
  }, [])

  return {
    statusMap,
    refreshAccountStatus,
    refreshAllStatus,
    startPolling: () => () => {},
    stopPolling: () => {},
    removeAccountStatus,
  }
}

export function useAccountStatusSelector(accountId: string) {
  return useAccountStatusStore(useCallback(state => state.statusMap[accountId], [accountId]))
}

export function useAllAccountStatus() {
  return useAccountStatusStore(state => state.statusMap)
}

export { useAccountStatusStore }
