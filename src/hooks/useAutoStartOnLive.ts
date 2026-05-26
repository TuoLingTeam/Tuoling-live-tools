/**
 * 开播自动启动 Hook
 * 当检测到直播状态变为 'live' 时，自动启动所有任务
 *
 * 注意：此功能使用账号隔离的存储，每个账号可以独立设置
 */

import { useEffect, useRef } from 'react'
import { getAccountPreference, setAccountPreference } from './useAccountPreference'
import { useAccounts } from './useAccounts'
import { useCurrentLiveControl } from './useLiveControl'
import { useOneClickStart } from './useOneClickStart'

const AUTO_START_ON_LIVE_KEY = 'auto-start-on-live-enabled'

function syncAutoStartOnLiveToMain(accountId: string, enabled: boolean): void {
  void window.liveControlAPI?.setAutoStartOnLive?.(accountId, enabled).catch(error => {
    console.warn('[AutoStartOnLive] 同步开播自动启动状态到主进程失败:', error)
  })
}

/**
 * 获取指定账号的开播自动启动设置
 * @param accountId 账号ID
 * @returns 是否启用开播自动启动
 */
export function getAccountAutoStartOnLive(accountId: string): boolean {
  return getAccountPreference(accountId, AUTO_START_ON_LIVE_KEY, false)
}

/**
 * 设置指定账号的开播自动启动
 * @param accountId 账号ID
 * @param value 是否启用
 */
export function setAccountAutoStartOnLive(accountId: string, value: boolean): void {
  setAccountPreference(accountId, AUTO_START_ON_LIVE_KEY, value)
  syncAutoStartOnLiveToMain(accountId, value)
}

/**
 * 监听直播状态，当变为 'live' 时自动启动任务
 */
export function useAutoStartOnLive() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const streamState = useCurrentLiveControl(context => context.streamState)
  const { startAllTasks, state, isAnyTaskRunning } = useOneClickStart()

  // 使用 ref 记录上一次的直播状态，避免重复触发
  const prevStreamStateRef = useRef(streamState)
  // 使用 ref 记录当前账号是否已经自动启动过，避免重复启动
  const hasAutoStartedRef = useRef(false)
  // 在状态未稳定时保留一次待启动意图，避免偶发漏触发
  const pendingAutoStartRef = useRef(false)
  const lastAccountIdRef = useRef(currentAccountId)

  useEffect(() => {
    if (!currentAccountId) return

    // 使用账号隔离的设置
    const isEnabled = getAccountAutoStartOnLive(currentAccountId)
    syncAutoStartOnLiveToMain(currentAccountId, isEnabled)

    // 【审计日志】状态检查
    console.log(
      `[AutoStartOnLive] [AUDIT] accountId=${currentAccountId}, isEnabled=${isEnabled}, streamState=${streamState}, prevState=${prevStreamStateRef.current}, hasAutoStarted=${hasAutoStartedRef.current}, pending=${pendingAutoStartRef.current}, isAnyTaskRunning=${isAnyTaskRunning}, canStart=${state.canStart}`,
    )

    if (!isEnabled) return

    // 直播状态从非 'live' 变为 'live'
    const wasNotLive = prevStreamStateRef.current !== 'live'
    const isNowLive = streamState === 'live'

    if (wasNotLive && isNowLive) {
      pendingAutoStartRef.current = true
      console.log(
        `[AutoStartOnLive] [AUDIT] Trigger pending auto-start for account ${currentAccountId}`,
      )
    }

    if (pendingAutoStartRef.current && !hasAutoStartedRef.current) {
      if (isAnyTaskRunning) {
        console.log(
          `[AutoStartOnLive] [AUDIT] Skip auto-start: tasks already running for account ${currentAccountId}`,
        )
        hasAutoStartedRef.current = true
        pendingAutoStartRef.current = false
      } else if (state.canStart) {
        console.log('[AutoStartOnLive] [AUDIT] Executing auto-start for account', currentAccountId)
        hasAutoStartedRef.current = true
        pendingAutoStartRef.current = false
        void startAllTasks()
      } else {
        console.log(
          `[AutoStartOnLive] [AUDIT] Cannot auto-start: canStart=false for account ${currentAccountId}`,
        )
      }
    }

    // 如果直播结束，重置自动启动标记
    if (streamState === 'ended' || streamState === 'offline') {
      hasAutoStartedRef.current = false
      pendingAutoStartRef.current = false
    }

    prevStreamStateRef.current = streamState
  }, [currentAccountId, isAnyTaskRunning, startAllTasks, state.canStart, streamState])

  useEffect(() => {
    if (lastAccountIdRef.current === currentAccountId) {
      return
    }

    lastAccountIdRef.current = currentAccountId
    hasAutoStartedRef.current = false
    pendingAutoStartRef.current = false
    prevStreamStateRef.current = streamState
  }, [currentAccountId, streamState])
}
