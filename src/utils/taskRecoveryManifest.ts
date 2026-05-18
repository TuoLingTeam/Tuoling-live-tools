import { useAccounts } from '@/hooks/useAccounts'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import type { StopReason, TaskId } from '@/tasks/types'
import { storageManager } from '@/utils/storage/StorageManager'

export const TASK_RECOVERY_SESSION_HEARTBEAT_MS = 10_000
export const TASK_RECOVERY_INTENT_MAX_AGE_MS = 12 * 60 * 60 * 1000

const RECOVERY_STORAGE_TYPE = 'task-recovery'
const RECOVERY_STORAGE_VERSION = 1

export interface TaskRecoverySession {
  id: string
  startedAt: string
  lastHeartbeatAt: string
  cleanShutdown: boolean
  endedAt?: string
}

export interface TaskRecoveryIntent {
  taskId: TaskId
  status: 'running'
  startedAt: string
  updatedAt: string
  lastStopReason?: StopReason
}

export interface AccountTaskRecoveryIntent {
  accountId: string
  accountName?: string
  platform?: LiveControlPlatform
  updatedAt: string
  tasks: Partial<Record<TaskId, TaskRecoveryIntent>>
}

export interface TaskRecoveryManifest {
  version: number
  userId: string
  updatedAt: string
  session: TaskRecoverySession | null
  previousSession?: TaskRecoverySession | null
  accounts: Record<string, AccountTaskRecoveryIntent>
}

export interface RecoverableAccountTasks {
  accountId: string
  accountName?: string
  platform?: LiveControlPlatform
  tasks: TaskId[]
  updatedAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function createSession(timestamp: string): TaskRecoverySession {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return {
    id: randomId,
    startedAt: timestamp,
    lastHeartbeatAt: timestamp,
    cleanShutdown: false,
  }
}

function createEmptyManifest(userId: string, timestamp = nowIso()): TaskRecoveryManifest {
  return {
    version: RECOVERY_STORAGE_VERSION,
    userId,
    updatedAt: timestamp,
    session: null,
    accounts: {},
  }
}

function getCurrentUserId(): string | null {
  return useAccounts.getState().currentUserId
}

function getAccountRecoveryMetadata(accountId: string): {
  accountName?: string
  platform?: LiveControlPlatform
} {
  const account = useAccounts.getState().accounts.find(item => item.id === accountId)
  const platform =
    useLiveControlStore.getState().contexts[accountId]?.connectState.platform || account?.platform

  return {
    accountName: account?.name,
    platform: platform ? (platform as LiveControlPlatform) : undefined,
  }
}

function isRecoverableStopReason(reason: StopReason): boolean {
  return reason === 'disconnected' || reason === 'error'
}

function getTaskUpdatedAt(task: TaskRecoveryIntent): number {
  const updatedAt = new Date(task.updatedAt).getTime()
  return Number.isFinite(updatedAt) ? updatedAt : 0
}

function pruneStaleTasks(
  manifest: TaskRecoveryManifest,
  timestamp = Date.now(),
): TaskRecoveryManifest {
  const accounts: Record<string, AccountTaskRecoveryIntent> = {}

  for (const [accountId, entry] of Object.entries(manifest.accounts)) {
    const tasks: Partial<Record<TaskId, TaskRecoveryIntent>> = {}
    for (const [taskId, task] of Object.entries(entry.tasks) as Array<
      [TaskId, TaskRecoveryIntent | undefined]
    >) {
      if (!task) {
        continue
      }
      const age = timestamp - getTaskUpdatedAt(task)
      if (age <= TASK_RECOVERY_INTENT_MAX_AGE_MS) {
        tasks[taskId] = task
      }
    }

    if (Object.keys(tasks).length > 0) {
      accounts[accountId] = {
        ...entry,
        tasks,
      }
    }
  }

  return {
    ...manifest,
    accounts,
  }
}

export function loadTaskRecoveryManifest(userId: string): TaskRecoveryManifest | null {
  try {
    const manifest = storageManager.get<TaskRecoveryManifest>(RECOVERY_STORAGE_TYPE, {
      level: 'user',
      userId,
    })

    if (!manifest || manifest.version !== RECOVERY_STORAGE_VERSION) {
      return null
    }

    return pruneStaleTasks(manifest)
  } catch (error) {
    console.warn('[TaskRecovery] 读取恢复意图失败:', error)
    return null
  }
}

export function saveTaskRecoveryManifest(manifest: TaskRecoveryManifest): void {
  try {
    storageManager.set(RECOVERY_STORAGE_TYPE, manifest, {
      level: 'user',
      userId: manifest.userId,
    })
  } catch (error) {
    console.warn('[TaskRecovery] 写入恢复意图失败:', error)
  }
}

function updateManifest(
  userId: string,
  updater: (manifest: TaskRecoveryManifest, timestamp: string) => TaskRecoveryManifest,
): TaskRecoveryManifest {
  const timestamp = nowIso()
  const base = loadTaskRecoveryManifest(userId) ?? createEmptyManifest(userId, timestamp)
  const next = updater(base, timestamp)
  const pruned = pruneStaleTasks({
    ...next,
    version: RECOVERY_STORAGE_VERSION,
    userId,
    updatedAt: timestamp,
  })

  saveTaskRecoveryManifest(pruned)
  return pruned
}

export function beginTaskRecoverySession(userId: string): TaskRecoveryManifest {
  return updateManifest(userId, (manifest, timestamp) => ({
    ...manifest,
    previousSession: manifest.session,
    session: createSession(timestamp),
  }))
}

export function markTaskRecoverySessionClean(userId: string): void {
  updateManifest(userId, (manifest, timestamp) => {
    if (!manifest.session) {
      return manifest
    }

    return {
      ...manifest,
      session: {
        ...manifest.session,
        cleanShutdown: true,
        endedAt: timestamp,
        lastHeartbeatAt: timestamp,
      },
    }
  })
}

export function heartbeatTaskRecoverySession(userId: string): void {
  updateManifest(userId, (manifest, timestamp) => ({
    ...manifest,
    session: manifest.session
      ? {
          ...manifest.session,
          lastHeartbeatAt: timestamp,
        }
      : createSession(timestamp),
  }))
}

export function markTaskRecoveryStarted(accountId: string, taskId: TaskId): void {
  const userId = getCurrentUserId()
  if (!userId) {
    return
  }

  updateManifest(userId, (manifest, timestamp) => {
    const metadata = getAccountRecoveryMetadata(accountId)
    const accountEntry = manifest.accounts[accountId] ?? {
      accountId,
      tasks: {},
      updatedAt: timestamp,
    }
    const existingTask = accountEntry.tasks[taskId]

    return {
      ...manifest,
      accounts: {
        ...manifest.accounts,
        [accountId]: {
          ...accountEntry,
          ...metadata,
          updatedAt: timestamp,
          tasks: {
            ...accountEntry.tasks,
            [taskId]: {
              taskId,
              status: 'running',
              startedAt: existingTask?.startedAt ?? timestamp,
              updatedAt: timestamp,
            },
          },
        },
      },
    }
  })
}

export function markTaskRecoveryStopped(
  accountId: string,
  taskId: TaskId,
  reason: StopReason,
): void {
  const userId = getCurrentUserId()
  if (!userId) {
    return
  }

  updateManifest(userId, (manifest, timestamp) => {
    const accountEntry = manifest.accounts[accountId]
    if (!accountEntry) {
      return manifest
    }

    if (isRecoverableStopReason(reason)) {
      const existingTask = accountEntry.tasks[taskId]
      if (!existingTask) {
        return manifest
      }

      return {
        ...manifest,
        accounts: {
          ...manifest.accounts,
          [accountId]: {
            ...accountEntry,
            updatedAt: timestamp,
            tasks: {
              ...accountEntry.tasks,
              [taskId]: {
                ...existingTask,
                updatedAt: timestamp,
                lastStopReason: reason,
              },
            },
          },
        },
      }
    }

    const nextTasks = { ...accountEntry.tasks }
    delete nextTasks[taskId]

    const nextAccounts = { ...manifest.accounts }
    if (Object.keys(nextTasks).length === 0) {
      delete nextAccounts[accountId]
    } else {
      nextAccounts[accountId] = {
        ...accountEntry,
        updatedAt: timestamp,
        tasks: nextTasks,
      }
    }

    return {
      ...manifest,
      accounts: nextAccounts,
    }
  })
}

export function clearTaskRecoveryAccount(accountId: string): void {
  const userId = getCurrentUserId()
  if (!userId) {
    return
  }

  updateManifest(userId, manifest => {
    const accounts = { ...manifest.accounts }
    delete accounts[accountId]
    return {
      ...manifest,
      accounts,
    }
  })
}

export function getRecoverableTaskAccounts(userId: string): RecoverableAccountTasks[] {
  const manifest = loadTaskRecoveryManifest(userId)
  if (!manifest) {
    return []
  }

  const knownAccountIds = new Set(useAccounts.getState().accounts.map(account => account.id))
  const result: RecoverableAccountTasks[] = []

  for (const [accountId, entry] of Object.entries(manifest.accounts)) {
    if (knownAccountIds.size > 0 && !knownAccountIds.has(accountId)) {
      continue
    }

    const tasks = Object.entries(entry.tasks)
      .filter(([, task]) => task?.status === 'running')
      .map(([taskId]) => taskId as TaskId)

    if (tasks.length === 0) {
      continue
    }

    result.push({
      accountId,
      accountName: entry.accountName,
      platform: entry.platform,
      tasks,
      updatedAt: entry.updatedAt,
    })
  }

  return result
}

export function shouldRecoverPreviousTaskSession(userId: string): boolean {
  const manifest = loadTaskRecoveryManifest(userId)
  if (!manifest?.previousSession || manifest.previousSession.cleanShutdown) {
    return false
  }

  const heartbeatAt = new Date(manifest.previousSession.lastHeartbeatAt).getTime()
  if (!Number.isFinite(heartbeatAt)) {
    return false
  }

  return Date.now() - heartbeatAt <= TASK_RECOVERY_INTENT_MAX_AGE_MS
}
