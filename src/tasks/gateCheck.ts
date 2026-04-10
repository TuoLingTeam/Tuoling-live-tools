/**
 * Gate 检查纯函数
 * 用于 TaskManager 中判断是否可以启动任务
 */

import type { StreamStatus } from 'shared/streamStatus'
import { evaluateLiveTaskGate } from '@/utils/taskGate'

export type GateCheckResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_CONNECTED' | 'NOT_LIVE' | 'AUTH_LOST'; message: string }

/**
 * 检查 Gate 条件
 * @param connectionState - 连接状态
 * @param streamState - 直播状态
 * @returns Gate 检查结果
 */
export function gateCanRun(
  connectionState: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error',
  streamState: StreamStatus,
): GateCheckResult {
  const result = evaluateLiveTaskGate({
    status: connectionState,
    streamState,
  })

  if (result.ok) {
    return { ok: true }
  }

  return {
    ok: false,
    reason: result.reason!,
    message: result.message,
  }
}
