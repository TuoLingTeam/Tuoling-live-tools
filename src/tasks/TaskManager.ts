/**
 * TaskManager - 统一任务调度器
 * 管理所有任务的启动、停止和状态
 * 【修复】支持多账号隔离，每个账号的任务状态独立管理
 */

import { getStopReasonText } from '@/utils/taskGate'
import {
  clearTaskRecoveryAccount,
  markTaskRecoveryStarted,
  markTaskRecoveryStopped,
} from '@/utils/taskRecoveryManifest'
import { gateCanRun } from './gateCheck'
import type { StopReason, Task, TaskContext, TaskId, TaskStatus } from './types'
import { BaseTask } from './types'

/**
 * 账号任务状态
 */
interface AccountTaskState {
  status: TaskStatus
  taskInstance: Task
}

/**
 * TaskManager 单例
 * 【修复】使用 Map<accountId, Map<taskId, AccountTaskState>> 实现账号隔离
 */
export class TaskManagerImpl {
  // 任务模板（用于创建每个账号的任务实例）
  private taskTemplates: Map<TaskId, new () => Task> = new Map()
  // 账号任务状态：accountId -> taskId -> AccountTaskState
  private accountTasks: Map<string, Map<TaskId, AccountTaskState>> = new Map()
  // 启动中的任务集合：用于锁住 await start() 窗口，防止重复启动
  private startInFlight: Set<string> = new Set()
  // 启动窗口内收到的停止请求：避免任务在断线/关播后“启动完成又继续跑”
  private pendingStopReasons: Map<string, StopReason> = new Map()
  // 已清理账号集合：用于区分“从未创建过”和“已显式清理”
  private cleanedAccounts: Set<string> = new Set()
  // 全局状态存储（向后兼容）
  private statusStore: Map<TaskId, TaskStatus> = new Map()

  /**
   * 注册任务模板
   */
  register(TaskClass: new () => Task): void {
    const tempTask = new TaskClass()
    this.taskTemplates.set(tempTask.id, TaskClass)
    this.statusStore.set(tempTask.id, 'idle')
    console.log(`[TaskManager] Registered task template: ${tempTask.id}`)
  }

  /**
   * 获取或创建账号的任务状态
   */
  private getOrCreateAccountTaskState(accountId: string, taskId: TaskId): AccountTaskState {
    this.cleanedAccounts.delete(accountId)

    if (!this.accountTasks.has(accountId)) {
      this.accountTasks.set(accountId, new Map())
    }

    const accountMap = this.accountTasks.get(accountId)!
    if (!accountMap.has(taskId)) {
      const TaskClass = this.taskTemplates.get(taskId)
      if (!TaskClass) {
        throw new Error(`Task template ${taskId} not found`)
      }
      accountMap.set(taskId, {
        status: 'idle',
        taskInstance: new TaskClass(),
      })
    }

    return accountMap.get(taskId)!
  }

  private getTaskScopeKey(accountId: string, taskId: TaskId): string {
    return `${accountId}:${taskId}`
  }

  private getPendingStopReason(accountId: string, taskId: TaskId): StopReason | undefined {
    return this.pendingStopReasons.get(this.getTaskScopeKey(accountId, taskId))
  }

  private setPendingStopReason(accountId: string, taskId: TaskId, reason: StopReason): void {
    this.pendingStopReasons.set(this.getTaskScopeKey(accountId, taskId), reason)
  }

  private clearPendingStopReason(accountId: string, taskId: TaskId): void {
    this.pendingStopReasons.delete(this.getTaskScopeKey(accountId, taskId))
  }

  /**
   * 获取任务状态（按账号隔离）
   */
  getStatus(taskId: TaskId, accountId?: string): TaskStatus {
    // 如果没有提供 accountId，返回全局状态（向后兼容）
    if (!accountId) {
      return this.statusStore.get(taskId) || 'idle'
    }

    // 按账号获取状态
    const accountMap = this.accountTasks.get(accountId)
    if (!accountMap) {
      return 'idle'
    }

    const taskState = accountMap.get(taskId)
    return taskState?.status || 'idle'
  }

  /**
   * 同步任务状态，不触发任务副作用。
   * 用于后端事件已发生后，仅校准前端调度器状态。
   */
  syncStatus(taskId: TaskId, status: TaskStatus, accountId: string): void {
    const accountMap = this.accountTasks.get(accountId)
    const taskState = accountMap?.get(taskId)
    if (!taskState) {
      return
    }

    taskState.status = status
    taskState.taskInstance.status = status
    this.statusStore.set(taskId, status)
  }

  /**
   * 启动任务
   * @param taskId - 任务 ID
   * @param ctx - 任务上下文
   * @returns 启动结果
   */
  async start(
    taskId: TaskId,
    ctx: TaskContext,
  ): Promise<{ success: boolean; reason?: string; message?: string }> {
    const accountId = ctx.accountId
    const taskScopeKey = this.getTaskScopeKey(accountId, taskId)

    // 【修复】获取或创建该账号的任务状态
    let taskState: AccountTaskState
    try {
      taskState = this.getOrCreateAccountTaskState(accountId, taskId)
    } catch (_error) {
      console.error(`[TaskManager] Task ${taskId} not found`)
      return { success: false, reason: 'TASK_NOT_FOUND', message: '任务未找到' }
    }

    const task = taskState.taskInstance

    // Gate 检查：由调用方显式提供运行上下文，避免 TaskManager 反向依赖 UI store
    if (ctx.gateState) {
      const gateResult = gateCanRun(ctx.gateState.connectionState, ctx.gateState.streamState)
      if (!gateResult.ok) {
        console.log(`[TaskManager] Gate check failed for task ${taskId}: ${gateResult.reason}`)
        return {
          success: false,
          reason: gateResult.reason,
          message: gateResult.message,
        }
      }
    } else {
      console.warn(
        `[TaskManager] Gate state not provided for account ${accountId}, skipping gate check`,
      )
    }

    // 任务实例可能被后端事件或任务内部直接置为 stopped/error，
    // 但调度器状态还停留在 running/stopping。这里先做一次自愈校准。
    if (
      (taskState.status === 'running' || taskState.status === 'stopping') &&
      task.status !== 'running' &&
      task.status !== 'stopping'
    ) {
      console.warn(
        `[TaskManager] Detected stale status for task ${taskId} on account ${accountId}, reconciling ${taskState.status} -> ${task.status}`,
      )
      taskState.status = task.status
      this.statusStore.set(taskId, task.status)
    }

    if (this.startInFlight.has(taskScopeKey)) {
      console.log(
        `[TaskManager] Task ${taskId} for account ${accountId} is already starting, preventing duplicate start`,
      )
      return { success: false, reason: 'ALREADY_RUNNING', message: '任务启动中' }
    }

    // 【Phase 2B-1】检查该账号的任务是否已在运行
    // 基于任务实例的真实状态，而非调度器状态
    const isActuallyRunning = task.status === 'running' || task.status === 'stopping'
    if (isActuallyRunning) {
      console.log(
        `[TaskManager] Task ${taskId} for account ${accountId} is actually ${task.status}, preventing duplicate start`,
      )
      return { success: false, reason: 'ALREADY_RUNNING', message: '任务已在运行中' }
    }
    // 如果调度器状态显示运行中但任务实例未运行，进行状态自愈
    if (taskState.status === 'running' || taskState.status === 'stopping') {
      console.warn(
        `[TaskManager] Status mismatch for task ${taskId} on account ${accountId}: scheduler=${taskState.status}, actual=${task.status}, reconciling...`,
      )
      taskState.status = task.status
      this.statusStore.set(taskId, task.status)
    }

    try {
      // 【修复】重置任务状态（如果之前停止过）
      if (taskState.status === 'stopped' && task instanceof BaseTask) {
        ;(task as BaseTask & { reset: () => void }).reset()
      }

      // 启动任务（先启动，成功后再更新状态，避免状态不一致）
      this.startInFlight.add(taskScopeKey)
      console.log(`[TaskManager] Starting task ${taskId} for account ${accountId}`)
      await task.start(ctx)

      // 【修复】任务启动成功后，更新该账号的任务状态
      taskState.status = 'running'
      task.status = 'running'
      this.statusStore.set(taskId, 'running')

      const pendingStopReason = this.getPendingStopReason(accountId, taskId)
      if (pendingStopReason) {
        console.warn(
          `[TaskManager] Task ${taskId} for account ${accountId} received a deferred stop during startup, stopping immediately. reason=${pendingStopReason}`,
        )
        this.clearPendingStopReason(accountId, taskId)
        await task.stop(pendingStopReason)
        taskState.status = task.status
        this.statusStore.set(taskId, task.status)
        return { success: true }
      }

      markTaskRecoveryStarted(accountId, taskId)
      console.log(`[TaskManager] Task ${taskId} started successfully for account ${accountId}`)

      return { success: true }
    } catch (error) {
      console.error(`[TaskManager] Failed to start task ${taskId} for account ${accountId}:`, error)
      // 【修复】启动失败时，确保状态回滚到 idle，避免"假运行"状态
      taskState.status = 'idle'
      task.status = 'idle'
      this.statusStore.set(taskId, 'idle')
      return {
        success: false,
        reason: 'ERROR',
        message: error instanceof Error ? error.message : '启动任务失败',
      }
    } finally {
      this.startInFlight.delete(taskScopeKey)
      if (taskState.status !== 'running') {
        this.clearPendingStopReason(accountId, taskId)
      }
    }
  }

  /**
   * 停止任务
   * @param taskId - 任务 ID
   * @param reason - 停止原因
   * @param accountId - 账号 ID（可选，用于精确停止指定账号的任务）
   */
  async stop(taskId: TaskId, reason: StopReason, accountId?: string): Promise<void> {
    // 【修复】如果提供了 accountId，只停止该账号的任务
    if (accountId) {
      const taskScopeKey = this.getTaskScopeKey(accountId, taskId)
      const accountMap = this.accountTasks.get(accountId)
      const hasStartInFlight = this.startInFlight.has(taskScopeKey)
      if (!accountMap) {
        if (hasStartInFlight) {
          this.setPendingStopReason(accountId, taskId, reason)
          console.warn(
            `[TaskManager] Deferred stop for task ${taskId} on account ${accountId} while task map is not ready. reason=${reason}`,
          )
          return
        }
        markTaskRecoveryStopped(accountId, taskId, reason)
        console.warn(`[TaskManager] No tasks found for account ${accountId}`)
        return
      }

      const taskState = accountMap.get(taskId)
      if (!taskState) {
        if (hasStartInFlight) {
          this.setPendingStopReason(accountId, taskId, reason)
          console.warn(
            `[TaskManager] Deferred stop for task ${taskId} on account ${accountId} while task instance is starting. reason=${reason}`,
          )
          return
        }
        markTaskRecoveryStopped(accountId, taskId, reason)
        console.warn(`[TaskManager] Task ${taskId} not found for account ${accountId}`)
        return
      }

      if (taskState.status === 'idle' || taskState.status === 'stopped') {
        if (hasStartInFlight) {
          this.setPendingStopReason(accountId, taskId, reason)
          console.warn(
            `[TaskManager] Deferred stop for task ${taskId} on account ${accountId} during startup window. schedulerStatus=${taskState.status}, reason=${reason}`,
          )
          return
        }
        console.log(
          `[TaskManager] Task ${taskId} for account ${accountId} is already ${taskState.status}`,
        )
        markTaskRecoveryStopped(accountId, taskId, reason)
        return
      }

      try {
        console.log(
          `[TaskManager] Stopping task ${taskId} for account ${accountId}, reason: ${reason}`,
        )
        await taskState.taskInstance.stop(reason)
        taskState.status = taskState.taskInstance.status
        markTaskRecoveryStopped(accountId, taskId, reason)
        console.log(
          `[TaskManager] Task ${taskId} stopped for account ${accountId}, final status: ${taskState.status}`,
        )
      } catch (error) {
        console.error(
          `[TaskManager] Error stopping task ${taskId} for account ${accountId}:`,
          error,
        )
        taskState.status = 'error'
        taskState.taskInstance.status = 'error'
      }
      return
    }

    // 【向后兼容】如果没有提供 accountId，停止所有账号的该任务
    console.log(`[TaskManager] Stopping task ${taskId} for all accounts`)
    for (const [accId, accountMap] of this.accountTasks.entries()) {
      const taskState = accountMap.get(taskId)
      if (taskState && taskState.status !== 'idle' && taskState.status !== 'stopped') {
        await this.stop(taskId, reason, accId)
      }
    }
  }

  /**
   * 停止指定账号的所有运行中的任务
   * @param accountId - 账号 ID
   * @param reason - 停止原因
   */
  async stopAllForAccount(accountId: string, reason: StopReason): Promise<void> {
    console.log(`[TaskManager] stopAllForAccount called for ${accountId}, reason: ${reason}`)
    const accountMap = this.accountTasks.get(accountId)
    const hasInFlightTask = Array.from(this.taskTemplates.keys()).some(taskId =>
      this.startInFlight.has(this.getTaskScopeKey(accountId, taskId)),
    )

    if (!accountMap && !hasInFlightTask) {
      console.log(`[TaskManager] No tasks found for account ${accountId}`)
      return
    }

    const taskIds = Array.from(this.taskTemplates.keys())
    const stoppableTasks = taskIds.filter(taskId => {
      const taskState = accountMap?.get(taskId)
      const schedulerRunning = taskState?.status === 'running' || taskState?.status === 'stopping'
      const starting = this.startInFlight.has(this.getTaskScopeKey(accountId, taskId))
      return schedulerRunning || starting
    })

    if (stoppableTasks.length === 0) {
      console.log(`[TaskManager] No running or starting tasks for account ${accountId}`)
      return
    }

    console.log(
      `[TaskManager] Stopping ${stoppableTasks.length} running/starting tasks for account ${accountId}`,
    )
    await Promise.all(stoppableTasks.map(taskId => this.stop(taskId, reason, accountId)))
  }

  /**
   * 停止所有运行中的任务（所有账号）
   * @param reason - 停止原因
   * @param toastCallback - 可选的 toast 回调
   */
  async stopAll(reason: StopReason, toastCallback?: (message: string) => void): Promise<void> {
    console.log(`[TaskManager] stopAll called with reason: ${reason}`)

    for (const accountId of this.accountTasks.keys()) {
      await this.stopAllForAccount(accountId, reason)
    }

    // 显示 toast（如果有回调且不是手动停止）
    if (toastCallback && reason !== 'manual') {
      const reasonText = getStopReasonText(reason)
      toastCallback(reasonText)
    }
  }

  /**
   * 获取所有任务状态（按账号）
   */
  getAllStatusForAccount(accountId: string): Record<TaskId, TaskStatus> {
    const accountMap = this.accountTasks.get(accountId)
    if (!accountMap && this.cleanedAccounts.has(accountId)) {
      return {} as Record<TaskId, TaskStatus>
    }

    const result: Record<string, TaskStatus> = {}
    for (const taskId of this.taskTemplates.keys()) {
      result[taskId] = accountMap?.get(taskId)?.status || 'idle'
    }
    return result as Record<TaskId, TaskStatus>
  }

  /**
   * 获取所有任务状态（全局，向后兼容）
   */
  getAllStatus(): Record<TaskId, TaskStatus> {
    const result: Record<string, TaskStatus> = {}
    for (const taskId of this.taskTemplates.keys()) {
      result[taskId] = this.getStatus(taskId)
    }
    return result as Record<TaskId, TaskStatus>
  }

  /**
   * 清理账号的所有任务状态（账号删除时调用）
   */
  cleanupAccount(accountId: string): void {
    console.log(`[TaskManager] Cleaning up tasks for account ${accountId}`)
    const accountMap = this.accountTasks.get(accountId)
    if (accountMap) {
      // 停止所有运行中的任务
      for (const [taskId, taskState] of accountMap.entries()) {
        if (taskState.status === 'running' || taskState.status === 'stopping') {
          try {
            const result = taskState.taskInstance.stop('manual')
            if (result instanceof Promise) {
              result.catch((error: Error) => {
                console.error(`[TaskManager] Error stopping task ${taskId} during cleanup:`, error)
              })
            }
          } catch (error) {
            console.error(`[TaskManager] Error stopping task ${taskId} during cleanup:`, error)
          }
        }
      }
      this.accountTasks.delete(accountId)
      this.cleanedAccounts.add(accountId)
    }

    for (const taskId of this.taskTemplates.keys()) {
      this.startInFlight.delete(this.getTaskScopeKey(accountId, taskId))
      this.clearPendingStopReason(accountId, taskId)
    }
    clearTaskRecoveryAccount(accountId)
  }
}

// 导出单例
export const taskManager = new TaskManagerImpl()
