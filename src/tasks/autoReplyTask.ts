/**
 * 自动回复任务实现
 */

import type { IpcInvoke } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import {
  createDefaultConfig,
  getSafeAutoReplyEntry,
  useAutoReplyConfigStore,
} from '@/hooks/useAutoReplyConfig'
import { acquireCommentListener, releaseCommentListener } from '@/utils/commentListenerRuntime'
import { BaseTask, type StopReason, type TaskContext } from './types'

export class AutoReplyTask extends BaseTask {
  private accountId: string | null = null

  constructor() {
    super('autoReply')
  }

  async start(ctx: TaskContext): Promise<void> {
    // 【审计日志】自动回复启动开始
    console.log(
      `[AutoReplyTask] [AUDIT] START accountId=${ctx.accountId}, currentTaskStatus=${this.status}`,
    )

    // 【修复】如果任务之前已经启动过，先清理旧的事件监听器
    // 防止重复注册导致的事件监听泄漏
    if (this.accountId && this.accountId !== ctx.accountId) {
      console.log(`[AutoReplyTask] Cleaning up old listeners for account ${this.accountId}`)
      this.executeDisposers()
    }

    this.accountId = ctx.accountId
    const config =
      useAutoReplyConfigStore.getState().contexts[ctx.accountId]?.config ?? createDefaultConfig()
    const autoReplyStore = useAutoReplyStore.getState()

    // 【审计日志】启动前状态
    const beforeIsRunning = autoReplyStore.contexts[ctx.accountId]?.isRunning ?? false
    const beforeIsListening = autoReplyStore.contexts[ctx.accountId]?.isListening ?? 'stopped'
    console.log(
      `[AutoReplyTask] [AUDIT] BEFORE_START accountId=${ctx.accountId}, isRunning=${beforeIsRunning}, isListening=${beforeIsListening}`,
    )

    // 更新状态为 waiting
    autoReplyStore.setIsListening(ctx.accountId, 'waiting')

    try {
      const result = await acquireCommentListener(
        ctx.accountId,
        'autoReply',
        {
          source: getSafeAutoReplyEntry(ctx.accountId, config.entry),
          ws: config.ws?.enable ? { port: config.ws.port, token: config.ws.token } : undefined,
        },
        ctx.ipcInvoke,
      )

      if (!result) {
        throw new Error('监听评论失败')
      }

      // 注册 IPC 事件监听器（用于后端主动停止时同步状态）
      // 【P2方案】使用账号隔离的事件通道，避免全局广播干扰
      const handleListenerStopped = (accountId: string) => {
        // 由于使用账号隔离的事件，这里不需要再检查 accountId
        if (this.status === 'running') {
          console.log(`[AutoReplyTask] Listener stopped by backend for account ${accountId}`)
          this.markBackendStopped()
          autoReplyStore.recordStopAudit(accountId, {
            reason: 'comment-listener-stopped',
            detail: '后端广播评论监听 stopped 事件',
          })
          this.stop('error')
        }
      }

      // 监听后端停止事件
      if (window.ipcRenderer) {
        // 【P2方案】监听账号隔离的事件通道
        const eventChannel = IPC_CHANNELS.tasks.commentListener.stoppedFor(ctx.accountId)
        const unsubscribe = window.ipcRenderer.on(
          eventChannel as `tasks:commentListener:stopped:${string}`,
          handleListenerStopped as (accountId: string) => void,
        )
        this.registerDisposable(() => unsubscribe())
      }

      // 更新状态为 listening
      autoReplyStore.setIsListening(ctx.accountId, 'listening')
      autoReplyStore.setIsRunning(ctx.accountId, true)
      this.status = 'running'

      // 【审计日志】启动成功
      console.log(
        `[AutoReplyTask] [AUDIT] SUCCESS accountId=${ctx.accountId}, isRunning=true, isListening=listening`,
      )

      ctx.toast.success('监听评论成功')
      console.log(`[AutoReplyTask] Started successfully for account ${ctx.accountId}`)
    } catch (error) {
      // 【审计日志】启动失败
      console.error(`[AutoReplyTask] [AUDIT] FAILED accountId=${ctx.accountId}, error=`, error)
      autoReplyStore.setIsListening(ctx.accountId, 'error')
      autoReplyStore.setIsRunning(ctx.accountId, false)
      this.status = 'error'
      ctx.toast.error('监听评论失败')
      throw error
    }
  }

  async stop(reason: StopReason): Promise<void> {
    if (this.status === 'stopped' || this.status === 'idle') {
      return
    }

    console.log(`[AutoReplyTask] Stopping, reason: ${reason}`)
    this.status = 'stopping'
    const backendAlreadyStopped = this.consumeBackendStopObserved()

    // 执行清理器（移除 IPC 监听器等）
    // 这会清理所有注册的清理函数，包括：
    // - IPC 事件监听器（账号隔离 stoppedFor 通道）
    // - 任何其他定时器、websocket 等资源
    this.executeDisposers()

    if (this.accountId) {
      const autoReplyStore = useAutoReplyStore.getState()
      const reasonMap: Record<StopReason, string> = {
        manual: 'manual',
        disconnected: 'disconnected',
        stream_ended: 'stream-ended',
        auth_lost: 'auth-lost',
        gate_failed: 'gate-failed',
        error: 'task-error',
      }
      const currentContext = autoReplyStore.contexts[this.accountId]
      const shouldPreserveExistingAudit =
        reason === 'error' && currentContext?.lastStopReason === 'comment-listener-stopped'
      if (!shouldPreserveExistingAudit) {
        autoReplyStore.recordStopAudit(this.accountId, {
          reason: reasonMap[reason],
          detail: `AutoReplyTask.stop(${reason})`,
        })
      }
      // 自动回复与数据监控共享底层评论监听。这里只释放自动回复消费者，
      // 仅当没有其他消费者时才真正停止监听器。
      if (!backendAlreadyStopped && window.ipcRenderer) {
        const invokeCommentListenerIpc: IpcInvoke = (channel, ...args) =>
          window.ipcRenderer.invoke(channel, ...args)
        await releaseCommentListener(this.accountId, 'autoReply', invokeCommentListenerIpc)
      }
      useAutoReplyStore.getState().setIsListening(this.accountId, 'stopped')
      useAutoReplyStore.getState().setIsRunning(this.accountId, false)
      console.log('[AutoReplyTask] Store state updated: isListening=stopped, isRunning=false')
    }

    this.status = 'stopped'
    this.isStopped = true
    console.log(`[AutoReplyTask] Stopped successfully, reason: ${reason}`)
  }

  protected reset(): void {
    super.reset()
    this.accountId = null
  }
}
