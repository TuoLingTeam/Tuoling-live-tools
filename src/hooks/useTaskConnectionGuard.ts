/**
 * 任务连接守卫 Hook
 * 监听连接状态变化，自动停止任务
 * 作为 disconnectedEvent 的兜底机制，确保连接断开时任务一定被停止
 */

import { useEffect, useRef } from 'react'
import { stopAllLiveTasks } from '@/utils/stopAllLiveTasks'
import { taskStateManager } from '@/utils/TaskStateManager'
import { useAccounts } from './useAccounts'
import { useCurrentLiveControl } from './useLiveControl'

type GuardConnectionStatus = 'connecting' | 'reconnecting' | 'connected' | 'disconnected' | 'error'

export function shouldStopTasksForConnectionLoss(params: {
  previousAccountId: string | null
  currentAccountId: string
  previousStatus: GuardConnectionStatus | null
  currentStatus: GuardConnectionStatus
  hasRunningTasks: boolean
}): boolean {
  const { previousAccountId, currentAccountId, previousStatus, currentStatus, hasRunningTasks } =
    params

  if (!currentAccountId || !hasRunningTasks) {
    return false
  }

  // 首次挂载或切换账号时，不把默认的 disconnected/error 视为“真实掉线”。
  if (previousAccountId !== currentAccountId || previousStatus === null) {
    return false
  }

  if (
    currentStatus !== 'disconnected' &&
    currentStatus !== 'reconnecting' &&
    currentStatus !== 'error'
  ) {
    return false
  }

  // 仅在同一账号从可用态/连接中掉到异常态时触发兜底停止。
  return previousStatus === 'connected' || previousStatus === 'connecting'
}

/**
 * 监听连接状态，自动停止任务（兜底机制）
 * 当连接断开或进入错误态时，委托统一停止入口处理
 */
export function useTaskConnectionGuard() {
  const connectState = useCurrentLiveControl(context => context.connectState)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const prevAccountIdRef = useRef<string | null>(null)
  const prevStatusRef = useRef<GuardConnectionStatus | null>(null)

  useEffect(() => {
    if (!currentAccountId) {
      prevAccountIdRef.current = null
      prevStatusRef.current = null
      return
    }

    const previousAccountId = prevAccountIdRef.current
    const previousStatus = prevStatusRef.current
    const hasRunningTasks = taskStateManager.hasAnyRunningTask(currentAccountId)
    const shouldStop = shouldStopTasksForConnectionLoss({
      previousAccountId,
      currentAccountId,
      previousStatus,
      currentStatus: connectState.status,
      hasRunningTasks,
    })

    prevAccountIdRef.current = currentAccountId
    prevStatusRef.current = connectState.status

    if (!shouldStop) {
      return
    }

    console.warn(
      `[TaskConnectionGuard] Detected connection loss for account ${currentAccountId}: ${previousStatus} -> ${connectState.status}`,
    )

    void stopAllLiveTasks(currentAccountId, 'disconnected', false).catch(error => {
      console.error('[TaskConnectionGuard] Failed to delegate stopAllLiveTasks:', error)
    })
  }, [connectState.status, currentAccountId])
}
