/**
 * 一键启动任务 Hook
 * 同时启动自动回复、自动发言、自动弹窗三个任务
 *
 * 注意：自动回复会自动触发数据监控的启动，这是通过 useAutoReply 内部的逻辑实现的
 * 参见 AutoReply/index.tsx 中的 startListening 函数
 */

import { useMemoizedFn } from 'ahooks'
import { useMemo, useState } from 'react'
import { taskManager } from '@/tasks'
import type { TaskContext, TaskId } from '@/tasks/types'
import { taskStateManager } from '@/utils/TaskStateManager'
import { getAccountPreference } from './useAccountPreference'
import { useAccounts } from './useAccounts'
import { useCurrentAutoMessage } from './useAutoMessage'
import { useCurrentAutoPopUp } from './useAutoPopUp'
import { useAutoReply } from './useAutoReply'
import { useLiveControlStore } from './useLiveControl'
import { useLiveFeatureGate } from './useLiveFeatureGate'
import { useLiveStatsStore } from './useLiveStats'
import { useToast } from './useToast'

export type OneClickStartTaskSelection = Record<TaskId, boolean>

export interface OneClickStartTaskOption {
  id: TaskId
  label: string
  description: string
}

export interface OneClickStartState {
  isLoading: boolean
  canStart: boolean
  gateMessage: string
  isAnyTaskRunning: boolean
}

export const ONE_CLICK_START_TASK_SELECTION_KEY = 'one-click-start-task-selection'

export const ONE_CLICK_START_TASKS: OneClickStartTaskOption[] = [
  {
    id: 'autoReply',
    label: '自动回复',
    description: '自动回复观众评论',
  },
  {
    id: 'autoSpeak',
    label: '自动发言',
    description: '按设定间隔自动发送消息',
  },
  {
    id: 'autoPopup',
    label: '自动弹窗',
    description: '自动展示商品弹窗',
  },
]

export const DEFAULT_ONE_CLICK_START_TASK_SELECTION: OneClickStartTaskSelection = {
  autoReply: true,
  autoSpeak: true,
  autoPopup: true,
}

interface TaskStartAttemptResult {
  task: string
  success: boolean
  message?: string
}

export interface StartAllTasksOptions {
  taskSelection?: Partial<OneClickStartTaskSelection>
}

function normalizeTaskSelection(
  value?: Partial<OneClickStartTaskSelection> | null,
): OneClickStartTaskSelection {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ONE_CLICK_START_TASK_SELECTION }
  }

  const selection = { ...DEFAULT_ONE_CLICK_START_TASK_SELECTION }
  for (const task of ONE_CLICK_START_TASKS) {
    selection[task.id] = value[task.id] !== false
  }

  return selection
}

export function getAccountOneClickStartTaskSelection(
  accountId: string,
): OneClickStartTaskSelection {
  return normalizeTaskSelection(
    getAccountPreference<Partial<OneClickStartTaskSelection> | null>(
      accountId,
      ONE_CLICK_START_TASK_SELECTION_KEY,
      null,
    ),
  )
}

export function useOneClickStart(): {
  state: OneClickStartState
  startAllTasks: (options?: StartAllTasksOptions) => Promise<void>
  stopAllTasks: () => void
  checkCanStart: () => boolean
  isAnyTaskRunning: boolean
} {
  const { toast } = useToast()
  const gate = useLiveFeatureGate()
  const currentAccountId = useAccounts(state => state.currentAccountId)

  // 自动回复
  const { isRunning: isAutoReplyRunning } = useAutoReply()

  // 自动发言
  const isAutoMessageRunning = useCurrentAutoMessage(ctx => ctx.isRunning)

  // 自动弹窗
  const isAutoPopUpRunning = useCurrentAutoPopUp(ctx => ctx.isRunning)

  const [isLoading, setIsLoading] = useState(false)

  const canStart = gate.canUse
  const gateMessage = gate.message

  const checkCanStart = useMemoizedFn(() => {
    if (!canStart) {
      toast.error(gateMessage)
      return false
    }
    return true
  })

  const createTaskContext = useMemoizedFn((): TaskContext => {
    const liveControlContext = useLiveControlStore.getState().contexts[currentAccountId]
    return {
      accountId: currentAccountId,
      gateState: liveControlContext
        ? {
            connectionState: liveControlContext.connectState.status,
            streamState: liveControlContext.streamState,
          }
        : undefined,
      toast: {
        success: () => {},
        error: () => {},
      },
      ipcInvoke: window.taskIPC.invoke,
    }
  })

  const startAllTasks = useMemoizedFn(async (options?: StartAllTasksOptions) => {
    if (!checkCanStart()) return

    const taskSelection = normalizeTaskSelection(
      options?.taskSelection ?? getAccountOneClickStartTaskSelection(currentAccountId),
    )
    const selectedTasks = ONE_CLICK_START_TASKS.filter(task => taskSelection[task.id])

    if (selectedTasks.length === 0) {
      toast.error({
        title: '未选择任务',
        description: '请至少选择一个需要一键开启的任务。',
        dedupeKey: `one-click-start-empty:${currentAccountId}`,
      })
      return
    }

    setIsLoading(true)
    const results: TaskStartAttemptResult[] = []

    try {
      const ctx = createTaskContext()
      const runningByTaskId: Record<TaskId, boolean> = {
        autoReply: isAutoReplyRunning,
        autoSpeak: isAutoMessageRunning,
        autoPopup: isAutoPopUpRunning,
      }

      for (const task of selectedTasks) {
        if (runningByTaskId[task.id]) {
          results.push({ task: task.label, success: true, message: '已在运行中' })
          continue
        }

        try {
          const result = await taskManager.start(task.id, ctx)
          results.push({
            task: task.label,
            success: result.success || result.reason === 'ALREADY_RUNNING',
            message: result.message,
          })
        } catch (error) {
          console.error(`[OneClickStart] Failed to start ${task.id}:`, error)
          results.push({
            task: task.label,
            success: false,
            message: error instanceof Error ? error.message : `启动${task.label}任务失败`,
          })
        }
      }

      const successCount = results.filter(r => r.success).length
      const totalCount = results.length
      const selectedTaskNames = selectedTasks.map(task => task.label).join('、')

      console.log('[OneClickStart] Start results:', results)

      if (successCount === totalCount) {
        toast.success({
          title: '启动中',
          description: `已开始启动${selectedTaskNames}，请稍等一下。`,
          dedupeKey: `one-click-start:${currentAccountId}`,
        })
      } else {
        const failedDetails = results
          .filter(r => !r.success)
          .map(r => `${r.task}${r.message ? `：${r.message}` : ''}`)
          .join('\n')
        toast.error({
          title: '部分任务未启动',
          description: `${failedDetails}\n请重试或单独开启。`,
          dedupeKey: `one-click-start-failed:${currentAccountId}`,
        })
      }
    } catch (error) {
      toast.error({
        title: '启动失败',
        description: '部分功能启动失败，你可以重试一次或单独开启。',
        dedupeKey: `one-click-start-error:${currentAccountId}`,
      })
      console.error('[OneClickStart] Failed to start tasks:', error)
    } finally {
      setIsLoading(false)
    }
  })

  const stopAllTasks = useMemoizedFn(async () => {
    const result = await taskStateManager.stopAllTasksForAccount(
      currentAccountId,
      'manual',
      true,
      message => {
        if (message === '当前无运行中的任务') {
          toast.info(message)
        } else {
          toast.success('已停止当前账号的自动任务')
        }
      },
    )

    // 记录结果
    console.log('[OneClickStart] Stop result:', {
      stopped: result.stoppedTasks,
      alreadyStopped: result.alreadyStopped,
      errors: result.errors.length,
    })
  })

  // 检查数据监控是否运行
  const isLiveStatsRunning = useLiveStatsStore(
    state => state.contexts[currentAccountId]?.isListening ?? false,
  )

  const isAnyTaskRunning =
    isAutoReplyRunning || isAutoMessageRunning || isAutoPopUpRunning || isLiveStatsRunning

  const state = useMemo(
    () => ({
      isLoading,
      canStart,
      gateMessage,
      isAnyTaskRunning,
    }),
    [isLoading, canStart, gateMessage, isAnyTaskRunning],
  )

  return {
    state,
    startAllTasks,
    stopAllTasks,
    checkCanStart,
    isAnyTaskRunning,
  }
}
