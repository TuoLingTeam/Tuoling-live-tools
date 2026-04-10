/**
 * 账号任务状态类型定义
 * 用于账号列表中的状态可视化
 */

import type { TaskStatus } from '@/tasks/types'

/** 连接状态 */
export type ConnectionStatus =
  | 'disconnected' // 未连接
  | 'connecting' // 连接中
  | 'reconnecting' // 恢复中
  | 'connected' // 已连接
  | 'error' // 连接错误

/** 任务信息 */
export interface TaskStatusInfo {
  /** 任务ID */
  taskId: string
  /** 任务状态 */
  status: TaskStatus
  /** 启动时间 */
  startTime?: number
  /** 运行时长(秒) */
  duration?: number
  /** 已执行次数/消息数 */
  count?: number
  /** 错误信息 */
  errorMessage?: string
}

/** 账号完整状态 */
export interface AccountTaskState {
  /** 账号ID */
  accountId: string
  /** 连接状态 */
  connectionStatus: ConnectionStatus
  /** 各任务状态 */
  tasks: TaskStatusInfo[]
  /** 最后更新时间 */
  lastUpdated: number
}

/** 状态显示配置 */
export interface StatusDisplayConfig {
  /** 状态类型 */
  type: 'running' | 'connected' | 'connecting' | 'error' | 'idle'
  /** 显示标签 */
  label: string
  /** 颜色主题 */
  color: 'green' | 'blue' | 'yellow' | 'red' | 'gray'
  /** 是否旋转动画 */
  animate?: boolean
}

/** 账号状态映射 */
export type AccountStatusMap = Record<string, AccountTaskState>

/** 状态优先级（用于确定显示哪个状态） */
export const STATUS_PRIORITY: Record<StatusDisplayConfig['type'], number> = {
  error: 100, // 最高优先级
  running: 90,
  connecting: 80,
  connected: 70,
  idle: 0, // 最低优先级
}
