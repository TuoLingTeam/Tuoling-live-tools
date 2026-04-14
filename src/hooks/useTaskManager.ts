/**
 * TaskManager Hook
 * 提供便捷的任务管理接口
 */

import { useMemoizedFn } from 'ahooks'
import { taskManager } from '@/tasks'
import { getGateTaskName } from '@/tasks/taskMeta'
import type { StopReason, TaskContext, TaskId } from '@/tasks/types'
import { getStopReasonText } from '@/utils/taskGate'
import { syncDirectTaskRuntimeFromMain } from '@/utils/taskRuntimeSync'
import { useAccounts } from './useAccounts'
import { useAutoMessageStore } from './useAutoMessage'
import { useAutoPopUpStore } from './useAutoPopUp'
import { useAutoReplyStore } from './useAutoReply'
import { useLiveControlStore } from './useLiveControl'
import { useToast } from './useToast'

/**
 * 使用 TaskManager 的 Hook
 */
export function useTaskManager() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const { toast } = useToast()

  const reconcileTaskStatusBeforeStart = useMemoizedFn((taskId: TaskId) => {
    switch (taskId) {
      case 'autoReply': {
        const context = useAutoReplyStore.getState().contexts[currentAccountId]
        const actuallyRunning =
          context?.isListening === 'listening' || context?.isListening === 'waiting'
        if (!actuallyRunning) {
          taskManager.syncStatus(taskId, 'stopped', currentAccountId)
        }
        break
      }
      case 'autoSpeak': {
        const context = useAutoMessageStore.getState().contexts[currentAccountId]
        if (!context?.isRunning) {
          taskManager.syncStatus(taskId, 'stopped', currentAccountId)
        }
        break
      }
      case 'autoPopup': {
        const context = useAutoPopUpStore.getState().contexts[currentAccountId]
        if (!context?.isRunning) {
          taskManager.syncStatus(taskId, 'stopped', currentAccountId)
        }
        break
      }
    }
  })

  /**
   * 创建任务上下文
   */
  const createContext = useMemoizedFn((): TaskContext => {
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
        success: (message: string) => toast.success(message),
        error: (message: string) => toast.error(message),
      },
      ipcInvoke: window.taskIPC.invoke,
    }
  })

  /**
   * 启动任务
   */
  const startTask = useMemoizedFn(async (taskId: TaskId): Promise<boolean> => {
    await syncDirectTaskRuntimeFromMain(currentAccountId, `before-start-${taskId}`)
    reconcileTaskStatusBeforeStart(taskId)
    const ctx = createContext()
    // 【Phase 2B-1】taskManager.start() 已基于任务实例真实状态返回 ALREADY_RUNNING
    const result = await taskManager.start(taskId, ctx)

    if (!result.success) {
      if (result.reason === 'NOT_CONNECTED' || result.reason === 'NOT_LIVE') {
        // Gate 检查失败，不显示 toast（由 GateButton 处理）
        console.log(`[useTaskManager] Gate check failed: ${result.message}`)
      } else if (result.reason === 'ALREADY_RUNNING') {
        // 【Phase 2B-1】基于真实运行状态的提示
        console.log(
          `[useTaskManager] Task ${taskId} is already running for account ${currentAccountId}`,
        )
        toast.info(result.message || '任务已在运行中')
      } else {
        toast.error(result.message || '启动任务失败')
      }
      return false
    }

    return true
  })

  /**
   * 停止任务
   */
  const stopTask = useMemoizedFn(
    async (taskId: TaskId, reason: StopReason = 'manual'): Promise<void> => {
      // 【修复】传入 accountId 以停止指定账号的任务
      await taskManager.stop(taskId, reason, currentAccountId)
      await syncDirectTaskRuntimeFromMain(currentAccountId, `after-stop-${taskId}`)

      // 显示停止提示（仅非手动停止时显示）
      if (reason !== 'manual') {
        const taskName = getGateTaskName(taskId)
        const reasonText = getStopReasonText(reason, taskName)
        toast.error(reasonText)
      }
    },
  )

  /**
   * 获取任务状态
   */
  const getTaskStatus = useMemoizedFn((taskId: TaskId) => {
    // 【修复】传入 accountId 以获取指定账号的任务状态
    return taskManager.getStatus(taskId, currentAccountId)
  })

  return {
    startTask,
    stopTask,
    getTaskStatus,
    taskManager,
  }
}
