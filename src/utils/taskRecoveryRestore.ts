import { useAccounts } from '@/hooks/useAccounts'
import { shouldDefaultHeadlessForPlatform, useChromeConfigStore } from '@/hooks/useChromeConfig'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { usePlatformPreferenceStore } from '@/stores/platformPreferenceStore'
import { taskManager } from '@/tasks'
import type { TaskContext, TaskId } from '@/tasks/types'
import {
  getRecoverableTaskAccounts,
  type RecoverableAccountTasks,
} from '@/utils/taskRecoveryManifest'

const TASK_GATE_READY_TIMEOUT_MS = 30_000
const CONNECT_READY_TIMEOUT_MS = 45_000
const WAIT_INTERVAL_MS = 500

export interface TaskRecoveryRestoreCallbacks {
  info?: (message: string) => void
  success?: (message: string) => void
  error?: (message: string) => void
}

export interface TaskRecoveryRestoreOptions {
  reason: 'startup' | 'reconnect'
  accountIds?: string[]
  callbacks?: TaskRecoveryRestoreCallbacks
}

export interface TaskRecoveryRestoreResult {
  attemptedAccounts: number
  restoredTasks: Array<{ accountId: string; taskId: TaskId }>
  failedTasks: Array<{ accountId: string; taskId: TaskId; error: string }>
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return true
    }
    await delay(WAIT_INTERVAL_MS)
  }

  return predicate()
}

function getTaskDisplayName(taskId: TaskId): string {
  const names: Record<TaskId, string> = {
    autoReply: '自动回复',
    autoPopup: '自动弹窗',
    autoSpeak: '自动发言',
  }
  return names[taskId]
}

function resolveRecoveryPlatform(entry: RecoverableAccountTasks): LiveControlPlatform {
  const connectState = useLiveControlStore.getState().contexts[entry.accountId]?.connectState
  const platform =
    entry.platform ||
    connectState?.platform ||
    usePlatformPreferenceStore.getState().getDefaultPlatform(entry.accountId)

  return (platform || 'buyin') as LiveControlPlatform
}

function createRecoveryTaskContext(accountId: string): TaskContext {
  const liveControlContext = useLiveControlStore.getState().contexts[accountId]

  return {
    accountId,
    gateState: liveControlContext
      ? {
          connectionState: liveControlContext.connectState.status,
          streamState: liveControlContext.streamState,
        }
      : undefined,
    toast: {
      success: message => console.log(`[TaskRecovery] ${message}`),
      error: message => console.warn(`[TaskRecovery] ${message}`),
    },
    ipcInvoke: window.taskIPC.invoke,
  }
}

async function ensureAccountConnected(entry: RecoverableAccountTasks): Promise<boolean> {
  const account = getAccountsSnapshot().find(item => item.id === entry.accountId)
  if (!account) {
    throw new Error('账号不存在，无法恢复任务')
  }

  const currentState = useLiveControlStore.getState().contexts[entry.accountId]?.connectState
  if (currentState?.status === 'connected') {
    return true
  }

  if (currentState?.status === 'connecting' || currentState?.status === 'reconnecting') {
    return await waitUntil(() => {
      const state = useLiveControlStore.getState().contexts[entry.accountId]?.connectState
      return state?.status === 'connected'
    }, CONNECT_READY_TIMEOUT_MS)
  }

  if (!window.liveControlAPI) {
    throw new Error('liveControlAPI 不可用，无法自动重连')
  }

  const platform = resolveRecoveryPlatform(entry)
  const chromeConfig = useChromeConfigStore.getState().contexts[entry.accountId]
  useLiveControlStore.getState().setConnectState(entry.accountId, {
    platform,
    status: 'connecting',
    phase: 'preparing',
    error: null,
    session: null,
    lastVerifiedAt: null,
  })

  const result = await window.liveControlAPI.connect({
    headless:
      platform === 'taobao'
        ? false
        : (chromeConfig?.headless ?? shouldDefaultHeadlessForPlatform(platform)),
    browserPath: chromeConfig?.path ?? '',
    storageState: chromeConfig?.storageState ?? '',
    platform,
    account,
    traceId: `task-recovery-${Date.now().toString(36)}`,
  })

  if (!result?.success || result.needsLogin) {
    return false
  }

  return await waitUntil(() => {
    const state = useLiveControlStore.getState().contexts[entry.accountId]?.connectState
    return state?.status === 'connected'
  }, CONNECT_READY_TIMEOUT_MS)
}

function getAccountsSnapshot(): Array<{
  id: string
  name: string
  platform?: LiveControlPlatform
}> {
  return useAccounts.getState().accounts
}

async function waitForTaskGateReady(accountId: string): Promise<boolean> {
  return await waitUntil(() => {
    const context = useLiveControlStore.getState().contexts[accountId]
    return context?.connectState.status === 'connected' && context.streamState === 'live'
  }, TASK_GATE_READY_TIMEOUT_MS)
}

async function restoreTasksForAccount(
  entry: RecoverableAccountTasks,
  callbacks?: TaskRecoveryRestoreCallbacks,
): Promise<TaskRecoveryRestoreResult> {
  const result: TaskRecoveryRestoreResult = {
    attemptedAccounts: 1,
    restoredTasks: [],
    failedTasks: [],
  }

  const connected = await ensureAccountConnected(entry)
  if (!connected) {
    const message = '中控台未能自动重连，任务未恢复'
    for (const taskId of entry.tasks) {
      result.failedTasks.push({ accountId: entry.accountId, taskId, error: message })
    }
    callbacks?.error?.(`${entry.accountName || entry.accountId} ${message}`)
    return result
  }

  const gateReady = await waitForTaskGateReady(entry.accountId)
  if (!gateReady) {
    const message = '直播状态未恢复为直播中，任务暂不自动启动'
    for (const taskId of entry.tasks) {
      result.failedTasks.push({ accountId: entry.accountId, taskId, error: message })
    }
    callbacks?.error?.(`${entry.accountName || entry.accountId} ${message}`)
    return result
  }

  for (const taskId of entry.tasks) {
    try {
      taskManager.syncStatus(taskId, 'stopped', entry.accountId)
      const startResult = await taskManager.start(
        taskId,
        createRecoveryTaskContext(entry.accountId),
      )
      if (!startResult.success && startResult.reason !== 'ALREADY_RUNNING') {
        throw new Error(startResult.message || '任务启动失败')
      }
      result.restoredTasks.push({ accountId: entry.accountId, taskId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failedTasks.push({ accountId: entry.accountId, taskId, error: message })
      callbacks?.error?.(
        `${entry.accountName || entry.accountId} ${getTaskDisplayName(taskId)}恢复失败：${message}`,
      )
    }
  }

  return result
}

function mergeRestoreResults(results: TaskRecoveryRestoreResult[]): TaskRecoveryRestoreResult {
  return {
    attemptedAccounts: results.reduce((sum, item) => sum + item.attemptedAccounts, 0),
    restoredTasks: results.flatMap(item => item.restoredTasks),
    failedTasks: results.flatMap(item => item.failedTasks),
  }
}

export async function restoreRecoverableTasks(
  userId: string,
  options: TaskRecoveryRestoreOptions,
): Promise<TaskRecoveryRestoreResult> {
  const accountFilter = options.accountIds ? new Set(options.accountIds) : null
  const entries = getRecoverableTaskAccounts(userId).filter(
    entry => !accountFilter || accountFilter.has(entry.accountId),
  )

  if (entries.length === 0) {
    return { attemptedAccounts: 0, restoredTasks: [], failedTasks: [] }
  }

  options.callbacks?.info?.('检测到崩溃前有任务运行，正在自动恢复')

  const results: TaskRecoveryRestoreResult[] = []
  for (const entry of entries) {
    results.push(await restoreTasksForAccount(entry, options.callbacks))
  }

  const merged = mergeRestoreResults(results)
  if (merged.restoredTasks.length > 0) {
    options.callbacks?.success?.(`已自动恢复 ${merged.restoredTasks.length} 个任务`)
  }

  return merged
}

export async function restoreRecoverableTasksForAccount(
  userId: string,
  accountId: string,
  callbacks?: TaskRecoveryRestoreCallbacks,
): Promise<TaskRecoveryRestoreResult> {
  return await restoreRecoverableTasks(userId, {
    reason: 'reconnect',
    accountIds: [accountId],
    callbacks,
  })
}
