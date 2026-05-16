import { Result } from '@praha/byethrow'
import { ErrorFactory } from '@praha/error-factory'
import { merge } from 'lodash-es'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AbortError } from '#/errors/AppError'
import type { ScopedLogger } from '#/logger'
import type { IPerformComment } from '#/platforms/IPlatform'
import { insertRandomSpaces, randomInt, replaceVariant, takeScreenshot } from '#/utils'
import windowManager from '#/windowManager'
import { createIntervalTask } from './IntervalTask'
import { runWithRetry } from './retry'

const TASK_NAME = '自动评论'

const retryOptions = {
  maxRetries: 3,
  retryDelay: 1000,
}

const MESSAGE_LOG_PREVIEW_LENGTH = 30

function createMessageLogContext(content: string, pinTop: boolean, index: number, total: number) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const preview =
    normalized.length > MESSAGE_LOG_PREVIEW_LENGTH
      ? `${normalized.slice(0, MESSAGE_LOG_PREVIEW_LENGTH)}...`
      : normalized

  return {
    messageIndex: index + 1,
    totalMessages: total,
    pinTop,
    length: content.length,
    preview,
  }
}

export function createAutoCommentTask(
  platform: IPerformComment,
  taskConfig: AutoCommentConfig,
  account: Account,
  lgr: ScopedLogger,
) {
  const logger = lgr.scope(TASK_NAME)
  let arrayIndex = -1
  let config = normalizeConfig(taskConfig)

  const intervalTaskResult = createIntervalTask(execute, {
    interval: config.scheduler.interval,
    logger,
    taskName: TASK_NAME,
  })

  if (Result.isFailure(intervalTaskResult)) {
    return intervalTaskResult
  }

  const intervalTask = intervalTaskResult.value

  function getNextMessage() {
    const messages = config.messages

    if (config.random) {
      if (messages.length <= 1) {
        arrayIndex = 0
      } else if (arrayIndex < 0) {
        arrayIndex = randomInt(0, messages.length - 1)
      } else {
        // 不和上一条消息重复
        const nextIndex = randomInt(0, messages.length - 2)
        if (nextIndex < arrayIndex) {
          arrayIndex = nextIndex
        } else {
          arrayIndex = nextIndex + 1
        }
      }
    } else {
      arrayIndex = (arrayIndex + 1) % messages.length
    }
    return messages[arrayIndex]
  }

  function validateConfig(userConfig: AutoCommentConfig): Result.Result<void, Error> {
    const normalizedConfig = normalizeConfig(userConfig)

    const validateMessage = (messages: AutoCommentConfig['messages']) => {
      const isEmptyArray = messages.length === 0
      const overLengthIndex = messages.findIndex(
        msg => msg.content.length > 50 && maxLength(msg.content) > 50,
      )
      if (isEmptyArray) return '必须提供至少一条消息'
      if (overLengthIndex >= 0) return `第 ${overLengthIndex + 1} 条消息字数超出 50 字`
    }

    return Result.pipe(
      // 验证 interval
      intervalTask.validateInterval(normalizedConfig.scheduler.interval),
      // 验证 messages
      Result.andThen(() => {
        const errMsg = validateMessage(normalizedConfig.messages)
        if (errMsg) return Result.fail(new MessageValidationError({ description: errMsg }))
        return Result.succeed()
      }),
      Result.inspect(_ =>
        logger.info(`消息配置验证通过，共加载 ${normalizedConfig.messages.length} 条消息`),
      ),
    )
  }

  async function execute(signal: AbortSignal) {
    const result = await runWithRetry(
      async () => {
        if (signal.aborted) {
          return Result.fail(new AbortError())
        }
        const message = getNextMessage()
        // 替换变量
        let content = replaceVariant(message.content)
        // 添加随机空格
        if (config.extraSpaces) {
          content = insertRandomSpaces(content)
        }
        const messageLogContext = createMessageLogContext(
          content,
          Boolean(message.pinTop),
          arrayIndex,
          config.messages.length,
        )
        const pinTop = await platform.performComment(content, message.pinTop)
        if (Result.isFailure(pinTop)) {
          logger.warn('消息发送返回失败：', messageLogContext, pinTop.error)
          return pinTop
        }
        logger.info('消息发送成功：', {
          ...messageLogContext,
          pinTop: pinTop.value,
        })
        return Result.succeed()
      },
      {
        ...retryOptions,
        logger,
        signal,
        onRetryError: () => {
          const page = platform.getCommentPage()
          if (page) takeScreenshot(page, TASK_NAME, account.name)
        },
      },
    )
    return result
  }

  /**
   * 【P1-2 运行时配置热更新】更新配置
   *
   * 可热更新项（无需重启任务）：
   * - messages: 消息列表（立即生效，下一条消息使用新配置）
   * - random: 随机发送模式（立即生效）
   * - extraSpaces: 随机空格（立即生效）
   * - scheduler.interval: 发送间隔（下一个周期生效）
   *
   * 仍需重启项（变更后需重启任务）：
   * - 无（所有配置都支持热更新）
   */
  function updateConfig(newConfig: Partial<AutoCommentConfig>) {
    const mergedConfig = normalizeConfig(merge({}, config, newConfig))
    return Result.pipe(
      validateConfig(mergedConfig),
      Result.andThen(_ => intervalTask.validateInterval(mergedConfig.scheduler.interval)),
      Result.inspect(() => {
        config = mergedConfig

        // 更新间隔（热更新，不重启任务）
        const intervalResult = intervalTask.updateInterval(mergedConfig.scheduler.interval)
        if (Result.isFailure(intervalResult)) {
          logger.error('[热更新] 间隔更新失败:', intervalResult.error)
        }

        // 记录变更的字段
        const changedFields: string[] = []
        if (newConfig.messages) changedFields.push('messages')
        if (newConfig.random !== undefined) changedFields.push('random')
        if (newConfig.extraSpaces !== undefined) changedFields.push('extraSpaces')
        if (newConfig.scheduler?.interval) changedFields.push('interval')

        logger.info(`[热更新] 配置已更新: [${changedFields.join(', ')}]，无需重启任务`)

        // 【P1-2 改进】不再调用 restart()，实现真正的热更新
        // intervalTask.restart()
      }),
      Result.inspectError(err => logger.error('配置更新失败：', err)),
    )
  }

  intervalTask.addStopListener(() => {
    // 发送账号隔离的停止事件
    windowManager.send(IPC_CHANNELS.tasks.autoMessage.stoppedFor(account.id), account.id)
  })

  return Result.pipe(
    validateConfig(config),
    Result.map(() => ({
      ...intervalTask,
      updateConfig,
    })),
  )
}

function maxLength(msg: string) {
  let length = 0
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '{') {
      const j = msg.indexOf('}', i + 1)
      if (j === -1) {
        // 找不到匹配括号，按正常的字符串长度计算
        length += msg.length - i
        break
      }
      const subLength = msg
        .slice(i + 1, j)
        .split('/')
        .reduce((max, v) => Math.max(max, v.length), 0)
      length += subLength
      i = j
    } else {
      length += 1
    }
  }
  return length
}

class MessageValidationError extends ErrorFactory({
  name: 'MessageValidationError',
  message: ({ description }) => `消息配置验证失败: ${description}`,
  fields: ErrorFactory.fields<{
    description: string
  }>(),
}) {}

function normalizeConfig(config: AutoCommentConfig): AutoCommentConfig {
  return {
    ...config,
    messages: normalizeMessages(config.messages),
  }
}

function normalizeMessages(messages: AutoCommentConfig['messages']): AutoCommentConfig['messages'] {
  return messages
    .map(message => ({
      ...message,
      content: message.content.trim(),
    }))
    .filter(message => message.content.length > 0)
}
