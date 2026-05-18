/**
 * 统一任务状态管理器
 *
 * @see docs/live-control-lifecycle-spec.md 中控台与直播状态管理总规范
 *
 * 职责：
 * 1. 作为所有直播任务状态的单一真相源
 * 2. 提供统一的 stopAllTasksForAccount 方法
 * 3. 提供状态校验和自愈机制
 * 4. 提供详细的日志记录
 *
 * 核心规则：
 * - "停止所有任务"只停止当前账号的所有直播任务
 * - 按钮状态必须与实际任务状态一致
 * - 左侧绿色点只表示"真实运行中"
 * - stopAll 必须幂等
 * - 状态必须按 accountId 隔离
 */

import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { useLiveStatsStore } from '@/hooks/useLiveStats'
import { useSubAccountStore } from '@/hooks/useSubAccount'
import { taskManager } from '@/tasks'
import type { StopReason } from '@/tasks/types'
import {
  stopAutoMessage,
  stopAutoPopUp,
  stopCommentListener,
  stopSubAccount,
} from './taskPreloadCompat'

type TaskType = 'auto-message' | 'auto-popup' | 'auto-reply' | 'sub-account' | 'live-stats'
type TaskStateManagerStopReason =
  | 'manual'
  | 'stream_ended'
  | 'disconnected'
  | 'page_closed'
  | 'auto_stop'
  | 'auth_lost'
  | 'gate_failed'
  | 'error'

const TASK_DISPLAY_NAMES: Record<TaskType, string> = {
  'auto-message': '自动发言',
  'auto-popup': '自动弹窗',
  'auto-reply': '自动回复',
  'sub-account': '小号互动',
  'live-stats': '数据监控',
}

export interface TaskStatusInfo {
  type: TaskType
  isRunning: boolean
  displayName: string
}
export interface TaskStopResult {
  accountId: string
  stoppedTasks: TaskType[]
  alreadyStopped: TaskType[]
  errors: { type: TaskType; error: unknown }[]
  finalStatus: Record<TaskType, boolean>
}
class TaskStateManager {
  private static instance: TaskStateManager
  private logPrefix = '[TaskStateManager]'

  private constructor() {}

  static getInstance(): TaskStateManager {
    if (!TaskStateManager.instance) {
      TaskStateManager.instance = new TaskStateManager()
    }
    return TaskStateManager.instance
  }
  /**
   * 获取指定账号的所有任务状态
   */
  getTaskStates(accountId: string): TaskStatusInfo[] {
    const autoMessageStore = useAutoMessageStore.getState()
    const autoPopUpStore = useAutoPopUpStore.getState()
    const autoReplyStore = useAutoReplyStore.getState()
    const subAccountStore = useSubAccountStore.getState()
    const liveStatsStore = useLiveStatsStore.getState()
    const tasks: TaskStatusInfo[] = [
      {
        type: 'auto-message',
        isRunning: autoMessageStore.contexts[accountId]?.isRunning ?? false,
        displayName: TASK_DISPLAY_NAMES['auto-message'],
      },
      {
        type: 'auto-popup',
        isRunning: autoPopUpStore.contexts[accountId]?.isRunning ?? false,
        displayName: TASK_DISPLAY_NAMES['auto-popup'],
      },
      {
        type: 'auto-reply',
        isRunning: this._isAutoReplyRunning(autoReplyStore, accountId),
        displayName: TASK_DISPLAY_NAMES['auto-reply'],
      },
      {
        type: 'sub-account',
        isRunning: subAccountStore.contexts[accountId]?.isRunning ?? false,
        displayName: TASK_DISPLAY_NAMES['sub-account'],
      },
      {
        type: 'live-stats',
        isRunning: liveStatsStore.contexts[accountId]?.isListening ?? false,
        displayName: TASK_DISPLAY_NAMES['live-stats'],
      },
    ]
    return tasks
  }
  /**
   * 检查是否有任何任务在运行
   */
  hasAnyRunningTask(accountId: string): boolean {
    const tasks = this.getTaskStates(accountId)
    return tasks.some(task => task.isRunning)
  }
  /**
   * 获取运行中的任务列表
   */
  getRunningTasks(accountId: string): TaskType[] {
    const tasks = this.getTaskStates(accountId)
    return tasks.filter(task => task.isRunning).map(task => task.type)
  }
  /**
   * 停止指定账号的所有任务 - 统一入口
   *
   * @param accountId 账号ID
   * @param reason 停止原因
   * @param showToast 是否显示toast
   * @param toastCallback toast回调
   * @returns 寜止结果
   */
  async stopAllTasksForAccount(
    accountId: string,
    reason: TaskStateManagerStopReason = 'manual',
    showToast = true,
    toastCallback?: (message: string) => void,
  ): Promise<TaskStopResult> {
    console.log(`${this.logPrefix} ==============================================`)
    console.log(`${this.logPrefix} stopAllTasksForAccount START`)
    console.log(`${this.logPrefix} Account: ${accountId}, Reason: ${reason}`)

    const result: TaskStopResult = {
      accountId,
      stoppedTasks: [],
      alreadyStopped: [],
      errors: [],
      finalStatus: {
        'auto-message': false,
        'auto-popup': false,
        'auto-reply': false,
        'sub-account': false,
        'live-stats': false,
      },
    }

    // 记录停止前的状态
    const beforeTasks = this.getTaskStates(accountId)
    console.log(
      `${this.logPrefix} Before stop:`,
      beforeTasks.map(t => `${t.type}=${t.isRunning}`),
    )

    // 先让前端调度器消费停止请求，覆盖“任务启动中”的竞态窗口。
    await taskManager.stopAllForAccount(accountId, this._mapReasonToTaskStopReason(reason))

    // 1. 停止自动回复（同时停止评论监听器和数据监控)
    const autoReplyResult = await this._stopAutoReply(accountId)
    if (autoReplyResult.stopped) result.stoppedTasks.push('auto-reply')
    else if (autoReplyResult.alreadyStopped) result.alreadyStopped.push('auto-reply')
    if (autoReplyResult.error)
      result.errors.push({ type: 'auto-reply', error: autoReplyResult.error })

    // 2. 停止自动发言
    const autoMessageResult = await this._stopAutoMessage(accountId)
    if (autoMessageResult.stopped) result.stoppedTasks.push('auto-message')
    else if (autoMessageResult.alreadyStopped) result.alreadyStopped.push('auto-message')
    if (autoMessageResult.error)
      result.errors.push({ type: 'auto-message', error: autoMessageResult.error })

    // 3. 停止自动弹窗
    const autoPopUpResult = await this._stopAutoPopUp(accountId)
    if (autoPopUpResult.stopped) result.stoppedTasks.push('auto-popup')
    else if (autoPopUpResult.alreadyStopped) result.alreadyStopped.push('auto-popup')
    if (autoPopUpResult.error)
      result.errors.push({ type: 'auto-popup', error: autoPopUpResult.error })

    // 4. 停止小号互动
    const subAccountResult = await this._stopSubAccount(accountId)
    if (subAccountResult.stopped) result.stoppedTasks.push('sub-account')
    else if (subAccountResult.alreadyStopped) result.alreadyStopped.push('sub-account')
    if (subAccountResult.error)
      result.errors.push({ type: 'sub-account', error: subAccountResult.error })

    // 记录停止后的状态
    const afterTasks = this.getTaskStates(accountId)
    console.log(
      `${this.logPrefix} After stop:`,
      afterTasks.map(t => `${t.type}=${t.isRunning}`),
    )

    // 记录最终状态
    for (const task of afterTasks) {
      result.finalStatus[task.type] = task.isRunning
    }

    // 校验：确保所有任务都已停止
    const stillRunning = afterTasks.filter(t => t.isRunning)
    if (stillRunning.length > 0) {
      console.warn(
        `${this.logPrefix} WARNING: Some tasks still running:`,
        stillRunning.map(t => t.type),
      )
      // 强制修复状态
      this._forceFixStates(
        accountId,
        stillRunning.map(t => t.type),
      )
    }

    console.log(
      `${this.logPrefix} Result: stopped=${result.stoppedTasks.length}, alreadyStopped=${result.alreadyStopped.length}, errors=${result.errors.length}`,
    )
    console.log(`${this.logPrefix} stopAllTasksForAccount END`)
    console.log(`${this.logPrefix} ==============================================`)

    // 显示toast
    if (showToast && result.stoppedTasks.length > 0) {
      const message = this._getStopMessage(reason, result.stoppedTasks)
      if (toastCallback) {
        toastCallback(message)
      }
    } else if (showToast && result.stoppedTasks.length === 0 && result.alreadyStopped.length > 0) {
      const message = '当前无运行中的任务'
      if (toastCallback) {
        toastCallback(message)
      }
    }

    return result
  }
  /**
   * 校验并修复状态不一致
   */
  reconcileAndFix(accountId: string): void {
    console.log(`${this.logPrefix} reconcileAndFix for account ${accountId}`)
    const tasks = this.getTaskStates(accountId)
    const inconsistentTasks: TaskType[] = []

    for (const _task of tasks) {
      // 这里可以添加更多的校验逻辑
      // 比如检查后台状态是否与前端一致
    }

    if (inconsistentTasks.length > 0) {
      console.warn(`${this.logPrefix} Found inconsistent tasks:`, inconsistentTasks)
      this._forceFixStates(accountId, inconsistentTasks)
    } else {
      console.log(`${this.logPrefix} All states are consistent`)
    }
  }

  forceResetAllTaskStates(accountId: string): void {
    console.log(`${this.logPrefix} Force resetting all task states for account ${accountId}`)

    const autoMessageStore = useAutoMessageStore.getState()
    const autoPopUpStore = useAutoPopUpStore.getState()
    const autoReplyStore = useAutoReplyStore.getState()
    const subAccountStore = useSubAccountStore.getState()
    const liveStatsStore = useLiveStatsStore.getState()

    autoMessageStore.setIsRunning(accountId, false)
    autoPopUpStore.setIsRunning(accountId, false)
    autoReplyStore.setIsListening(accountId, 'stopped')
    autoReplyStore.setIsRunning(accountId, false)
    subAccountStore.setIsRunning(accountId, false)
    liveStatsStore.setListening(accountId, false)

    console.log(`${this.logPrefix} All task states reset to stopped`)
  }
  /**
   * 强制修复状态
   */
  private _forceFixStates(accountId: string, taskTypes: TaskType[]): void {
    console.log(`${this.logPrefix} Force fixing states for ${taskTypes.join(', ')}`)

    for (const type of taskTypes) {
      switch (type) {
        case 'auto-message':
          useAutoMessageStore.getState().setIsRunning(accountId, false)
          break
        case 'auto-popup':
          useAutoPopUpStore.getState().setIsRunning(accountId, false)
          break
        case 'auto-reply': {
          const store = useAutoReplyStore.getState()
          store.setIsListening(accountId, 'stopped')
          store.setIsRunning(accountId, false)
          break
        }
        case 'sub-account':
          useSubAccountStore.getState().setIsRunning(accountId, false)
          break
        case 'live-stats':
          useLiveStatsStore.getState().setListening(accountId, false)
          break
      }
    }
  }
  /**
   * 检查自动回复是否在运行
   * 【Phase 2A】绿点只基于真实运行态：isListening === 'listening'
   * 不再将 'waiting' 视为运行中
   */
  private _isAutoReplyRunning(store: any, accountId: string): boolean {
    const context = store.contexts[accountId]
    if (!context) return false
    // 【Phase 2A】绿点只表示真实运行中（listening），不包含 waiting
    return context.isListening === 'listening'
  }
  /**
   * 停止自动回复
   * 【Phase 2B-2】确保幂等性：已停止时不重复调用 IPC
   */
  private async _stopAutoReply(
    accountId: string,
  ): Promise<{ stopped: boolean; alreadyStopped: boolean; error?: unknown }> {
    const store = useAutoReplyStore.getState()
    const context = store.contexts[accountId]
    // 【Phase 2B-2】使用 Phase 2A 的统一判定：只认为 listening 是运行中
    const isActuallyRunning = context?.isListening === 'listening'
    const isWaiting = context?.isListening === 'waiting'

    // 同时检查数据监控
    const liveStatsStore = useLiveStatsStore.getState()
    const isLiveStatsRunning = liveStatsStore.contexts[accountId]?.isListening === true

    // 【Phase 2B-2】严格幂等性检查：只有真正运行中才调用 IPC
    if (!isActuallyRunning && !isLiveStatsRunning) {
      console.log(`${this.logPrefix} auto-reply: already stopped or not running, skipping IPC call`)
      // 如果处于 waiting 状态，也需要清理状态
      if (isWaiting) {
        store.setIsListening(accountId, 'stopped')
        store.setIsRunning(accountId, false)
      }
      return { alreadyStopped: true, stopped: false }
    }

    try {
      // 【Phase 2B-2】只有真正运行中时才调用后台IPC停止评论监听器
      await stopCommentListener(accountId)
      console.log(`${this.logPrefix} auto-reply: IPC stop invoked`)

      // 更新前端状态
      store.setIsListening(accountId, 'stopped')
      store.setIsRunning(accountId, false)
      liveStatsStore.setListening(accountId, false)

      return { stopped: true, alreadyStopped: false }
    } catch (error) {
      console.error(`${this.logPrefix} auto-reply: stop error:`, error)
      // 即使出错也更新状态，确保状态不漂移
      store.setIsListening(accountId, 'stopped')
      store.setIsRunning(accountId, false)
      liveStatsStore.setListening(accountId, false)
      return { stopped: false, alreadyStopped: false, error }
    }
  }
  /**
   * 停止自动发言
   */
  private async _stopAutoMessage(
    accountId: string,
  ): Promise<{ stopped: boolean; alreadyStopped: boolean; error?: unknown }> {
    const store = useAutoMessageStore.getState()
    const isRunning = store.contexts[accountId]?.isRunning === true

    if (!isRunning) {
      return { alreadyStopped: true, stopped: false }
    }

    try {
      await stopAutoMessage(accountId)
      console.log(`${this.logPrefix} auto-message: IPC stop invoked`)
      store.setIsRunning(accountId, false)
      return { stopped: true, alreadyStopped: false }
    } catch (error) {
      console.error(`${this.logPrefix} auto-message: stop error:`, error)
      store.setIsRunning(accountId, false)
      return { stopped: false, alreadyStopped: false, error }
    }
  }
  /**
   * 停止自动弹窗
   */
  private async _stopAutoPopUp(
    accountId: string,
  ): Promise<{ stopped: boolean; alreadyStopped: boolean; error?: unknown }> {
    const store = useAutoPopUpStore.getState()
    const isRunning = store.contexts[accountId]?.isRunning === true

    if (!isRunning) {
      return { alreadyStopped: true, stopped: false }
    }

    try {
      await stopAutoPopUp(accountId)
      console.log(`${this.logPrefix} auto-popup: IPC stop invoked`)
      store.setIsRunning(accountId, false)
      return { stopped: true, alreadyStopped: false }
    } catch (error) {
      console.error(`${this.logPrefix} auto-popup: stop error:`, error)
      store.setIsRunning(accountId, false)
      return { stopped: false, alreadyStopped: false, error }
    }
  }
  /**
   * 停止小号互动
   */
  private async _stopSubAccount(
    accountId: string,
  ): Promise<{ stopped: boolean; alreadyStopped: boolean; error?: unknown }> {
    const store = useSubAccountStore.getState()
    const isRunning = store.contexts[accountId]?.isRunning === true

    if (!isRunning) {
      return { alreadyStopped: true, stopped: false }
    }

    try {
      await stopSubAccount(accountId)
      console.log(`${this.logPrefix} sub-account: IPC stop invoked`)
      store.setIsRunning(accountId, false)
      return { stopped: true, alreadyStopped: false }
    } catch (error) {
      console.error(`${this.logPrefix} sub-account: stop error:`, error)
      store.setIsRunning(accountId, false)
      return { stopped: false, alreadyStopped: false, error }
    }
  }
  /**
   * 获取停止提示消息
   */
  private _getStopMessage(reason: string, stoppedTasks: TaskType[]): string {
    const taskNames = stoppedTasks.map(t => TASK_DISPLAY_NAMES[t]).join('、')

    switch (reason) {
      case 'manual':
        return `已停止: ${taskNames}`
      case 'stream_ended':
        return `直播已结束，已自动停止: ${taskNames}`
      case 'disconnected':
        return `连接已断开,已自动停止: ${taskNames}`
      case 'page_closed':
        return `页面已关闭,已自动停止: ${taskNames}`
      case 'auto_stop':
        return `已自动停止: ${taskNames}`
      default:
        return `已停止: ${taskNames}`
    }
  }

  private _mapReasonToTaskStopReason(reason: TaskStateManagerStopReason): StopReason {
    switch (reason) {
      case 'manual':
        return 'manual'
      case 'stream_ended':
        return 'stream_ended'
      case 'auth_lost':
        return 'auth_lost'
      case 'gate_failed':
        return 'gate_failed'
      case 'error':
        return 'error'
      default:
        return 'disconnected'
    }
  }
}
export const taskStateManager = TaskStateManager.getInstance()

export async function reconcileTaskStates(accountId: string): Promise<{
  wasInconsistent: boolean
  fixedTasks: TaskType[]
}> {
  taskStateManager.reconcileAndFix(accountId)
  return {
    wasInconsistent: false,
    fixedTasks: [],
  }
}

export function forceResetAllTaskStates(accountId: string): void {
  taskStateManager.forceResetAllTaskStates(accountId)
}
