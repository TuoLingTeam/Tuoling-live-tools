/**
 * Task 生命周期模型 - 统一类型定义
 */
import type { IpcInvoke } from 'shared/electron-api'

/**
 * 任务 ID
 */
export type TaskId = 'autoReply' | 'autoPopup' | 'autoSpeak'

/**
 * 任务状态
 */
export type TaskStatus = 'idle' | 'running' | 'stopping' | 'stopped' | 'error'

/**
 * 停止原因
 */
export type StopReason =
  | 'manual'
  | 'disconnected'
  | 'stream_ended'
  | 'auth_lost'
  | 'gate_failed'
  | 'error'

/**
 * 清理函数类型
 */
export type Disposable = () => void

/**
 * Task 上下文
 * 包含任务运行所需的依赖
 */
export interface TaskContext {
  accountId: string
  gateState?: {
    connectionState: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
    streamState: import('shared/streamStatus').StreamStatus
  }
  toast: {
    success: (message: string) => void
    error: (message: string) => void
  }
  ipcInvoke: IpcInvoke
  // Store 更新函数（可选，由具体任务决定）
  updateStatus?: (status: TaskStatus) => void
}

/**
 * Task 接口
 */
export interface Task {
  /** 任务 ID */
  id: TaskId
  /** 当前状态 */
  status: TaskStatus
  /** 启动任务 */
  start(ctx: TaskContext): Promise<void> | void
  /** 停止任务 */
  stop(reason: StopReason): Promise<void> | void
}

/**
 * BaseTask 工具类
 * 提供统一的清理器管理
 */
export class BaseTask implements Task {
  id: TaskId
  status: TaskStatus = 'idle'
  protected disposers: Disposable[] = []
  protected isStopped = false
  protected backendStopObserved = false

  constructor(id: TaskId) {
    this.id = id
  }

  /**
   * 注册清理器
   */
  protected registerDisposable(fn: Disposable): void {
    this.disposers.push(fn)
  }

  /**
   * 执行所有清理器
   */
  protected executeDisposers(): void {
    for (const dispose of this.disposers) {
      try {
        dispose()
      } catch (error) {
        console.error(`[Task] Error executing disposer for task ${this.id}:`, error)
      }
    }
    this.disposers = []
  }

  protected markBackendStopped(): void {
    this.backendStopObserved = true
  }

  protected consumeBackendStopObserved(): boolean {
    const observed = this.backendStopObserved
    this.backendStopObserved = false
    return observed
  }

  /**
   * 启动任务（由子类实现）
   */
  start(_ctx: TaskContext): Promise<void> | void {
    throw new Error(`Task ${this.id} must implement start()`)
  }

  /**
   * 停止任务（幂等）
   */
  stop(reason: StopReason): Promise<void> | void {
    if (this.isStopped || this.status === 'stopped') {
      console.log(`[Task] Task ${this.id} already stopped, ignoring stop call`)
      return
    }

    if (this.status === 'stopping') {
      console.log(`[Task] Task ${this.id} already stopping, ignoring stop call`)
      return
    }

    console.log(`[Task] Stopping task ${this.id}, reason: ${reason}`)
    this.status = 'stopping'
    this.executeDisposers()
    this.status = 'stopped'
    this.isStopped = true
  }

  /**
   * 重置状态（用于重新启动）
   */
  protected reset(): void {
    this.status = 'idle'
    this.isStopped = false
    this.backendStopObserved = false
  }
}
