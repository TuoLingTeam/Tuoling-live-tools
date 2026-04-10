/**
 * 直播功能 Gate Hook
 * 统一管理所有直播相关功能的运行前置条件
 */

import { useMemo } from 'react'
import type { StreamStatus } from 'shared/streamStatus'
import { evaluateLiveTaskGate } from '@/utils/taskGate'
import { useCurrentLiveControl } from './useLiveControl'

export type GateReason = 'NOT_CONNECTED' | 'NOT_LIVE' | 'AUTH_LOST' | 'UNKNOWN'
export type GateAction = 'CONNECT' | 'GO_LIVE' | 'RELOGIN' | null

export interface LiveFeatureGate {
  canUse: boolean
  disabled: boolean
  reason: GateReason | null
  message: string
  action: GateAction
  connectionState: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
  streamState: StreamStatus
}

/**
 * 直播功能 Gate Hook
 *
 * @returns LiveFeatureGate
 */
export function useLiveFeatureGate(): LiveFeatureGate {
  const connectState = useCurrentLiveControl(context => context.connectState)
  const streamState = useCurrentLiveControl(context => context.streamState)

  return useMemo(() => {
    const connectionStatus = connectState.status

    // 记录 Gate 状态计算（用于调试）
    console.log(
      `[gate] Gate calculation: connectionStatus=${connectionStatus}, streamState=${streamState}`,
    )

    const evaluation = evaluateLiveTaskGate({
      status: connectionStatus,
      streamState,
    })

    let reason: GateReason | null = evaluation.ok ? null : (evaluation.reason as GateReason)
    let message = evaluation.message
    const action: GateAction = evaluation.ok ? null : (evaluation.action ?? null)

    const canUse = evaluation.ok
    const disabled = !canUse

    // 如果没有特定原因，但不可用，则设为 UNKNOWN
    if (!canUse && reason === null) {
      reason = 'UNKNOWN'
      message = '当前状态不可用，请稍后重试'
    }

    const gateResult = {
      canUse,
      disabled,
      reason,
      message,
      action,
      connectionState: connectionStatus,
      streamState,
    }

    // 记录 Gate 计算结果（仅在状态变化时）
    console.log(
      `[gate] Gate result: canUse=${canUse}, reason=${reason}, connectionState=${connectionStatus}, streamState=${streamState}`,
    )

    return gateResult
  }, [connectState.status, streamState])
}
