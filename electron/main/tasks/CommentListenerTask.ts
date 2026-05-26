import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { ScopedLogger } from '#/logger'
import type { ICommentListener } from '#/platforms/IPlatform'
import { WebSocketService } from '#/services/WebSocketService'
import windowManager from '#/windowManager'
import { createTask } from './BaseTask'

const TASK_NAME = '自动回复'

/**
 * 消息批量发送缓冲区
 * 优化：减少高频 IPC 调用，批量发送评论消息
 * - 每 100ms 或累积 10 条消息时批量发送
 * - 预期效果：减少 70-90% 的 IPC 调用次数
 */
class MessageBuffer {
  private buffer: Array<{ accountId: string; comment: LiveMessage }> = []
  private timer: NodeJS.Timeout | null = null
  private readonly flushInterval = 100 // 100ms 批量发送
  private readonly maxBufferSize = 10 // 最多累积 10 条

  constructor(
    private readonly onFlush: (
      messages: Array<{ accountId: string; comment: LiveMessage }>,
    ) => void,
  ) {}

  add(accountId: string, comment: LiveMessage) {
    this.buffer.push({ accountId, comment })

    // 达到最大缓冲量时立即发送
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush()
      return
    }

    // 启动定时器
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval)
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.buffer.length > 0) {
      this.onFlush([...this.buffer])
      this.buffer = []
    }
  }

  clear() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.buffer = []
  }
}

export function createCommentListenerTask(
  platform: ICommentListener,
  config: CommentListenerConfig,
  account: Account,
  _logger: ScopedLogger,
) {
  const logger = _logger.scope(TASK_NAME)
  let wsService: WebSocketService | null

  // 创建消息缓冲区，批量发送 IPC 消息
  const messageBuffer = new MessageBuffer(messages => {
    windowManager.send(IPC_CHANNELS.tasks.commentListener.showComment, { messages })
  })

  async function execute() {
    try {
      if (config.ws) {
        wsService = new WebSocketService()
        // WebSocket 服务启动失败不会影响评论监听
        wsService.start(config.ws).catch(err => {
          wsService?.stop(err)
          wsService = null
        })
      }
      await platform.startCommentListener(broadcastMessage, config.source)
      logger.info('开始监听评论')
    } catch (err) {
      // 失败了还要告诉渲染层关闭按钮
      // 发送账号隔离的停止事件
      windowManager.send(IPC_CHANNELS.tasks.commentListener.stoppedFor(account.id), account.id)
      // 【P0修复】移除重复的 task.stop()，统一由 BaseTask.start() 的 catch 块处理
      // task.stop(TaskStopReason.ERROR, err)
      // 【P0修复】向上抛出异常，让上层感知启动失败
      throw err
    }
  }

  function broadcastMessage(message: LiveMessage) {
    const comment: LiveMessage = {
      ...message,
      time: new Date().toLocaleTimeString(),
    }

    // 使用缓冲区批量发送 IPC 消息
    messageBuffer.add(account.id, comment)

    // WebSocket 广播不需要批量化（已经是异步的）
    wsService?.broadcast(comment)
  }

  function updateConfig(cfg: Partial<CommentListenerConfig>) {
    if (cfg.ws === undefined && config.ws) {
      config.ws = undefined
      wsService?.stop()
      wsService = null
    }
    if (cfg.ws && (cfg.ws.port !== config.ws?.port || cfg.ws.token !== config.ws?.token)) {
      config.ws = cfg.ws
      if (!wsService) {
        wsService = new WebSocketService()
      }
      wsService.stop()
      wsService.start(config.ws).catch(err => {
        wsService?.stop(err)
        wsService = null
      })
    }
    if (cfg.source && config.source !== cfg.source) {
      const nextSource = cfg.source
      config.source = nextSource
      void Promise.resolve(platform.stopCommentListener())
        .then(() => platform.startCommentListener(broadcastMessage, nextSource))
        .catch(error => {
          logger.error('切换评论监听来源失败：', error)
        })
    }
    return Result.succeed()
  }

  const task = createTask(
    {
      taskName: TASK_NAME,
      logger,
    },
    {
      onStart: async () => {
        await execute()
      },
      onStop: async () => {
        // 发送缓冲区中剩余的消息
        messageBuffer.flush()
        messageBuffer.clear()
        await platform.stopCommentListener()
        wsService?.stop()
        wsService = null
      },
    },
  )

  return Result.succeed({
    ...task,
    updateConfig,
  })
}
