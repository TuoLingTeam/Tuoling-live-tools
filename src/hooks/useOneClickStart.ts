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
import type { TaskContext } from '@/tasks/types'
import { taskStateManager } from '@/utils/TaskStateManager'
import { useAccounts } from './useAccounts'
import { useCurrentAutoMessage } from './useAutoMessage'
import { useCurrentAutoPopUp } from './useAutoPopUp'
import { useAutoReply } from './useAutoReply'
import { useLiveControlStore } from './useLiveControl'
import { useLiveFeatureGate } from './useLiveFeatureGate'
import { useLiveStatsStore } from './useLiveStats'
import { useToast } from './useToast'

export interface OneClickStartState {
  isLoading: boolean
  canStart: boolean
  gateMessage: string
  isAnyTaskRunning: boolean
}

interface TaskStartAttemptResult {
  task: string
  success: boolean
  message?: string
}

export function useOneClickStart(): {
  state: OneClickStartState
  startAllTasks: () => Promise<void>
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

  const startAllTasks = useMemoizedFn(async () => {
    if (!checkCanStart()) return

    setIsLoading(true)
    const results: TaskStartAttemptResult[] = []

    try {
      const ctx = createTaskContext()
      if (!isAutoReplyRunning) {
        const autoReplyResult = await taskManager.start('autoReply', ctx)
        results.push({
          task: '自动回复',
          success: autoReplyResult.success || autoReplyResult.reason === 'ALREADY_RUNNING',
          message: autoReplyResult.message,
        })
      } else {
        results.push({ task: '自动回复', success: true, message: '已在运行中' })
      }

      if (!isAutoMessageRunning) {
        try {
          const result = await taskManager.start('autoSpeak', ctx)
          results.push({
            task: '自动发言',
            success: result.success || result.reason === 'ALREADY_RUNNING',
            message: result.message,
          })
        } catch (error) {
          console.error('[OneClickStart] Failed to start auto speak:', error)
          results.push({
            task: '自动发言',
            success: false,
            message: error instanceof Error ? error.message : '启动自动发言任务失败',
          })
        }
      } else {
        results.push({ task: '自动发言', success: true, message: '已在运行中' })
      }

      if (!isAutoPopUpRunning) {
        const result = await taskManager.start('autoPopup', ctx)
        results.push({
          task: '自动弹窗',
          success: result.success || result.reason === 'ALREADY_RUNNING',
          message: result.message,
        })
      } else {
        results.push({ task: '自动弹窗', success: true, message: '已在运行中' })
      }

      const successCount = results.filter(r => r.success).length
      const totalCount = results.length

      console.log('[OneClickStart] Start results:', results)

      if (successCount === totalCount) {
        toast.success({
          title: '启动中',
          description: '已开始启动自动任务，请稍等一下。',
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
