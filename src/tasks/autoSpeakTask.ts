/**
 * 自动发言任务实现
 */

import { IPC_CHANNELS } from 'shared/ipcChannels'
import { getEffectiveAutoMessages, useAutoMessageStore } from '@/hooks/useAutoMessage'
import { onAutoMessageStopped, stopAutoMessage } from '@/utils/taskPreloadCompat'
import type { StopReason, TaskContext } from './types'
import { BaseTask } from './types'

export class AutoSpeakTask extends BaseTask {
  private accountId: string | null = null

  constructor() {
    super('autoSpeak')
  }

  async start(ctx: TaskContext): Promise<void> {
    // 【修复】如果任务之前已经启动过，先清理旧的事件监听器
    // 防止重复注册导致的事件监听泄漏
    if (this.accountId && this.accountId !== ctx.accountId) {
      console.log(`[AutoSpeakTask] Cleaning up old listeners for account ${this.accountId}`)
      this.executeDisposers()
    }

    this.accountId = ctx.accountId
    const config = useAutoMessageStore.getState().contexts[ctx.accountId]?.config

    if (!config) {
      throw new Error('自动发言配置不存在')
    }

    const runtimeMessages = getEffectiveAutoMessages(config.messages).map(
      ({ content, pinTop }) => ({
        content,
        pinTop,
      }),
    )

    if (runtimeMessages.length === 0) {
      ctx.toast.error('请至少配置一条非空消息')
      this.status = 'error'
      throw new Error('自动发言缺少有效消息')
    }

    try {
      // 启动任务
      const result = await ctx.ipcInvoke(IPC_CHANNELS.tasks.autoMessage.start, ctx.accountId, {
        ...config,
        messages: runtimeMessages,
      })

      if (!result) {
        throw new Error('启动自动发言任务失败')
      }

      // 注册 IPC 事件监听器（用于后端主动停止时同步状态）
      // 【P2方案】使用账号隔离的事件通道，避免全局广播干扰
      const handleStopped = (accountId: string) => {
        // 由于使用账号隔离的事件，这里不需要再检查 accountId
        if (this.status === 'running') {
          console.log(`[AutoSpeakTask] Task stopped by backend for account ${accountId}`)
          this.markBackendStopped()
          this.stop('error')
        }
      }

      const unsubscribe = onAutoMessageStopped(ctx.accountId, handleStopped)
      this.registerDisposable(() => unsubscribe())

      // 更新状态
      useAutoMessageStore.getState().setIsRunning(ctx.accountId, true)
      this.status = 'running'

      ctx.toast.success('自动发言任务已启动')
      console.log(`[AutoSpeakTask] Started successfully for account ${ctx.accountId}`)
    } catch (error) {
      console.error('[AutoSpeakTask] Failed to start:', error)
      useAutoMessageStore.getState().setIsRunning(ctx.accountId, false)
      this.status = 'error'
      ctx.toast.error('启动自动发言任务失败')
      throw error
    }
  }

  async stop(reason: StopReason): Promise<void> {
    if (this.status === 'stopped' || this.status === 'idle') {
      return
    }

    console.log(`[AutoSpeakTask] Stopping, reason: ${reason}`)
    this.status = 'stopping'
    const backendAlreadyStopped = this.consumeBackendStopObserved()

    // 执行清理器（移除 IPC 监听器等）
    // 这会清理所有注册的清理函数，包括：
    // - IPC 事件监听器（账号隔离 stoppedFor 通道）
    // - 任何其他定时器、websocket 等资源
    this.executeDisposers()

    // 调用 IPC 停止任务（后端会清理 interval/timer/abort controller）
    if (this.accountId) {
      try {
        if (!backendAlreadyStopped) {
          await stopAutoMessage(this.accountId)
          console.log('[AutoSpeakTask] IPC stop invoked successfully')
        }
      } catch (error) {
        console.error('[AutoSpeakTask] Error stopping IPC task:', error)
      }

      // 更新状态
      useAutoMessageStore.getState().setIsRunning(this.accountId, false)
      console.log('[AutoSpeakTask] Store state updated: isRunning=false')
    }

    this.status = 'stopped'
    this.isStopped = true
    console.log(`[AutoSpeakTask] Stopped successfully, reason: ${reason}`)
  }

  protected reset(): void {
    super.reset()
    this.accountId = null
  }
}
