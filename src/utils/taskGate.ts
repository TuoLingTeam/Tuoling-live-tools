/**
 * 任务运行守门人机制
 * 统一管理所有直播相关任务的运行前置条件
 */
import type { StreamStatus } from 'shared/streamStatus'
import { type GateTaskName, getTaskDisplayName } from '@/tasks/taskMeta'

export type TaskStopReason =
  | 'disconnected'
  | 'stream_ended'
  | 'auth_lost'
  | 'manual'
  | 'gate_failed'
  | 'error'

export type TaskStartReasonCode = 'NOT_CONNECTED' | 'NOT_LIVE' | 'AUTH_LOST'

export type TaskAction = 'CONNECT' | 'GO_LIVE' | 'RELOGIN'

export interface TaskStartCheckResult {
  ok: boolean
  reason?: TaskStartReasonCode
  message: string
  action?: TaskAction
}

interface TaskGateContext {
  status: string
  streamState?: StreamStatus
}

function buildConnectionMessage(
  status: string,
  displayName?: string,
): { message: string; action: TaskAction } {
  const requiresSpecificTask = Boolean(displayName)

  if (status === 'disconnected') {
    return {
      message: requiresSpecificTask
        ? `请先连接直播中控台\n连接成功后才能使用【${displayName}】`
        : '请先连接直播中控台',
      action: 'CONNECT',
    }
  }

  if (status === 'connecting') {
    return {
      message: requiresSpecificTask
        ? `正在连接中控台，请稍候\n连接成功后才能使用【${displayName}】`
        : '正在连接中控台，请稍候',
      action: 'CONNECT',
    }
  }

  if (status === 'reconnecting') {
    return {
      message: requiresSpecificTask
        ? `中控台连接中断，正在尝试恢复\n恢复完成后才能使用【${displayName}】`
        : '中控台连接中断，正在尝试恢复，请稍候',
      action: 'CONNECT',
    }
  }

  return {
    message: requiresSpecificTask
      ? `中控台连接异常，请重新连接\n连接成功后才能使用【${displayName}】`
      : '中控台连接异常，请重新连接',
    action: 'CONNECT',
  }
}

function buildLiveMessage(
  streamState: StreamStatus,
  displayName?: string,
): { message: string; action: TaskAction } {
  const requiresSpecificTask = Boolean(displayName)

  if (requiresSpecificTask) {
    const stateMessages: Record<StreamStatus, string> = {
      unknown: '直播状态未知',
      offline: '当前未开播',
      live: '直播中',
      ended: '直播已结束',
    }

    return {
      message: `${stateMessages[streamState]}\n请先开播，再启动【${displayName}】`,
      action: 'GO_LIVE',
    }
  }

  if (streamState === 'ended') {
    return {
      message: '直播已结束，请重新开播后再启用该功能',
      action: 'GO_LIVE',
    }
  }

  return {
    message: '当前未开播，请先开始直播后再启用该功能',
    action: 'GO_LIVE',
  }
}

export function evaluateLiveTaskGate(
  connectState: TaskGateContext,
  taskName?: GateTaskName,
): TaskStartCheckResult {
  const displayName = taskName ? getTaskDisplayName(taskName) : undefined

  if (connectState.status !== 'connected') {
    const { message, action } = buildConnectionMessage(connectState.status, displayName)
    return {
      ok: false,
      reason: 'NOT_CONNECTED',
      message,
      action,
    }
  }

  const streamState = connectState.streamState ?? 'unknown'
  if (streamState !== 'live') {
    const { message, action } = buildLiveMessage(streamState, displayName)
    return {
      ok: false,
      reason: 'NOT_LIVE',
      message,
      action,
    }
  }

  return { ok: true, message: '' }
}

/**
 * 检查是否可以启动任务（统一前置校验）
 *
 * @param connectState - 连接状态
 * @param taskName - 任务名称（'auto-reply' | 'auto-comment' | 'auto-popup'）
 * @returns TaskStartCheckResult
 */
export function ensureCanStartTask(
  connectState: TaskGateContext,
  taskName: GateTaskName,
): TaskStartCheckResult {
  return evaluateLiveTaskGate(connectState, taskName)
}

/**
 * 检查是否可以运行直播相关任务（向后兼容）
 *
 * @deprecated 使用 ensureCanStartTask 代替
 */
export function canRunLiveTasks(connectState: { status: string }): {
  canRun: boolean
  reason?: string
} {
  const check = evaluateLiveTaskGate(connectState)
  return {
    canRun: check.ok,
    reason: check.message,
  }
}

/**
 * 获取任务停止原因的描述文本（用于强制停止时的提示）
 */
export function getStopReasonText(reason: TaskStopReason, taskName?: string): string {
  const displayName = getTaskDisplayName(taskName)

  const reasonMap: Record<TaskStopReason, string> = {
    disconnected: `连接已断开，${displayName}已停止`,
    stream_ended: `直播已结束，${displayName}已停止`,
    auth_lost: `登录已失效，${displayName}已停止\n请重新扫码登录后再启动任务`,
    manual: `${displayName}已停止`,
    gate_failed: `条件不满足，${displayName}已停止`,
    error: `发生错误，${displayName}已停止`,
  }
  return reasonMap[reason] || `${displayName}已停止`
}
