import { Result } from '@praha/byethrow'
import { ErrorFactory } from '@praha/error-factory'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { isSameSubAccountLiveRoomUrl } from 'shared/subAccountLiveRoom'
import { AbortError } from '#/errors/AppError'
import type { ScopedLogger } from '#/logger'
import {
  type SubAccountSession,
  SubAccountVerificationRequiredError,
  subAccountManager,
} from '#/managers/SubAccountManager'
import {
  insertRandomSpaces,
  type MessageTemplateContext,
  randomInt,
  replaceMessageTemplate,
  sleep,
} from '#/utils'
import { RateLimiter } from '#/utils/RateLimiter'
import windowManager from '#/windowManager'
import { createTask } from './BaseTask'
import { createIntervalTask } from './IntervalTask'
import { runWithRetry } from './retry'

const TASK_NAME = '小号互动'

const retryOptions = {
  maxRetries: 2,
  retryDelay: 1000,
}

export function createSubAccountInteractionTask(
  taskConfig: SubAccountInteractionConfig,
  account: Account,
  lgr: ScopedLogger,
) {
  const logger = lgr.scope(TASK_NAME)
  let config = { ...taskConfig }
  let currentMessageIndex = -1
  let currentAccountIndex = -1
  let currentGroupIndex = 0
  let currentAccountIndexInGroup = 0

  const rateLimiters = new Map<LiveControlPlatform, RateLimiter>()

  config.accounts.forEach(acc => {
    if (!rateLimiters.has(acc.platform)) {
      rateLimiters.set(acc.platform, new RateLimiter(acc.platform))
    }
  })

  function ensureRateLimiter(platform: LiveControlPlatform): RateLimiter {
    let limiter = rateLimiters.get(platform)
    if (!limiter) {
      limiter = new RateLimiter(platform)
      rateLimiters.set(platform, limiter)
    }
    return limiter
  }

  const intervalTaskResult = createIntervalTask(execute, {
    interval: config.scheduler.interval,
    logger,
    taskName: TASK_NAME,
  })

  if (Result.isFailure(intervalTaskResult)) {
    return intervalTaskResult
  }

  const intervalTask = intervalTaskResult.value

  function getNextMessage(): { content: string; weight?: number } {
    const messages = config.messages
    if (messages.length === 0) return { content: '' }

    if (config.random) {
      const totalWeight = messages.reduce((sum, m) => sum + (m.weight || 1), 0)
      let randomWeight = Math.random() * totalWeight

      for (let i = 0; i < messages.length; i++) {
        randomWeight -= messages[i].weight || 1
        if (randomWeight <= 0) {
          currentMessageIndex = i
          break
        }
      }
      // 浮点误差可能导致未命中，兜底取第一条
      if (currentMessageIndex < 0) currentMessageIndex = 0
    } else {
      currentMessageIndex = (currentMessageIndex + 1) % messages.length
    }

    return messages[currentMessageIndex] ?? messages[0]
  }

  function getEligibleAccounts(targetLiveRoomUrl: string): SubAccountSession[] {
    const configuredIds = new Set(config.accounts.map(acc => acc.id))
    const orderById = new Map(config.accounts.map((account, index) => [account.id, index]))
    return subAccountManager
      .getConnectedAccounts()
      .filter(account => configuredIds.has(account.id))
      .filter(
        account =>
          account.liveRoomStatus === 'entered' &&
          isSameSubAccountLiveRoomUrl(account.liveRoomUrl, targetLiveRoomUrl),
      )
      .sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0))
  }

  function getNextAccount(targetLiveRoomUrl: string, depth = 0): SubAccountSession | null {
    // 防止无限递归导致栈溢出
    if (depth > 10) {
      logger.warn('分组轮换深度过大，返回 null')
      return null
    }

    const eligibleAccounts = getEligibleAccounts(targetLiveRoomUrl)
    if (eligibleAccounts.length === 0) return null

    const enabledGroups = (config.groups ?? []).filter(g => g.enabled)
    const useGroups = config.rotateGroups && enabledGroups.length > 0

    let candidates: SubAccountSession[]
    if (useGroups) {
      const group = enabledGroups[currentGroupIndex % enabledGroups.length]
      const orderById = new Map(group.accountIds.map((id, i) => [id, i]))
      candidates = eligibleAccounts
        .filter(a => orderById.has(a.id))
        .sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0))
      if (candidates.length === 0) {
        currentGroupIndex++
        currentAccountIndexInGroup = 0
        return getNextAccount(targetLiveRoomUrl, depth + 1)
      }
      const account = candidates[currentAccountIndexInGroup % candidates.length]
      currentAccountIndexInGroup++
      if (currentAccountIndexInGroup >= candidates.length) {
        currentAccountIndexInGroup = 0
        currentGroupIndex++
      }
      return account
    }

    candidates = eligibleAccounts
    if (config.rotateAccounts) {
      currentAccountIndex = (currentAccountIndex + 1) % candidates.length
      return candidates[currentAccountIndex]
    }
    return candidates[randomInt(0, candidates.length - 1)]
  }

  function validateConfig(userConfig: SubAccountInteractionConfig): Result.Result<void, Error> {
    const validateMessages = (messages: SubAccountInteractionConfig['messages']) => {
      const isEmptyArray = messages.length === 0
      const overLengthIndex = messages.findIndex(msg => msg.content.length > 50)
      const emptyContentIndex = messages.findIndex(msg => msg.content.trim().length === 0)
      if (isEmptyArray) return '必须提供至少一条消息'
      if (overLengthIndex >= 0) return `第 ${overLengthIndex + 1} 条消息字数超出 50 字`
      if (emptyContentIndex >= 0) return `第 ${emptyContentIndex + 1} 条消息为空`
    }

    const validateAccounts = (accounts: SubAccountConfig[]) => {
      if (accounts.length === 0) return '至少添加一个小号'
    }

    const validateLiveRoomUrl = (liveRoomUrl?: string) => {
      if (!liveRoomUrl?.trim()) return '请先设置直播间地址'
      try {
        new URL(liveRoomUrl)
      } catch {
        return '直播间地址格式无效'
      }
    }

    return Result.pipe(
      intervalTask.validateInterval(userConfig.scheduler.interval),
      Result.andThen(() => {
        const errMsg = validateMessages(userConfig.messages)
        if (errMsg) return Result.fail(new MessageValidationError({ description: errMsg }))
        return Result.succeed()
      }),
      Result.andThen(() => {
        const errMsg = validateAccounts(userConfig.accounts)
        if (errMsg) return Result.fail(new AccountValidationError({ description: errMsg }))
        return Result.succeed()
      }),
      Result.andThen(() => {
        const errMsg = validateLiveRoomUrl(userConfig.liveRoomUrl)
        if (errMsg) return Result.fail(new AccountValidationError({ description: errMsg }))
        return Result.succeed()
      }),
      Result.inspect(_ =>
        logger.info(
          `配置验证通过，共 ${userConfig.accounts.length} 个小号，${userConfig.messages.length} 条消息`,
        ),
      ),
    )
  }

  async function execute(signal: AbortSignal) {
    const result = await runWithRetry(
      async () => {
        if (signal.aborted) {
          return Result.fail(new AbortError())
        }

        const targetLiveRoomUrl = config.liveRoomUrl?.trim()
        if (!targetLiveRoomUrl) {
          return Result.fail(new Error('直播间地址未配置'))
        }

        const subAccount = getNextAccount(targetLiveRoomUrl)
        if (!subAccount) {
          logger.warn('没有已进入目标直播间的小号，跳过本次发送')
          return Result.succeed()
        }

        const rateLimiter = ensureRateLimiter(subAccount.platform)
        const canSend = rateLimiter.canSend(subAccount.stats.lastSendTime)
        if (!canSend) {
          const nextTime = rateLimiter.getNextAvailableTime(subAccount.stats.lastSendTime)
          const waitMs = Math.max(0, nextTime - Date.now())
          if (waitMs > 0) {
            logger.info(`小号 ${subAccount.name} 频率限制，跳过本次发送`)
            return Result.succeed()
          }
        }

        const message = getNextMessage()
        const templateContext: MessageTemplateContext = {
          currentTime: new Date(),
          streamerName: '主播',
        }
        let content = replaceMessageTemplate(message.content, templateContext)
        if (config.extraSpaces) {
          content = insertRandomSpaces(content)
        }

        // 同步等待发送完成，而不是只入队
        const sendResult = await subAccountManager.sendComment(subAccount.id, content)
        const success = Result.isSuccess(sendResult)

        if (success) {
          logger.success(`小号 ${subAccount.name} 发送成功：${content}`)
        } else {
          if (sendResult.error instanceof SubAccountVerificationRequiredError) {
            const verificationMessage = sendResult.error.message
            logger.warn(
              `小号 ${subAccount.name} 触发平台安全验证，任务将暂停：${verificationMessage}`,
            )
            windowManager.send(IPC_CHANNELS.tasks.subAccount.accountStatusChanged, account.id, {
              accountId: subAccount.id,
              accountName: subAccount.name,
              verificationRequired: true,
              verificationMessage,
              timestamp: Date.now(),
            })
            return Result.fail(sendResult.error)
          }

          logger.error(`小号 ${subAccount.name} 发送失败：${sendResult.error.message}`)
        }

        // 更新限流器状态
        const limiter = ensureRateLimiter(subAccount.platform)
        limiter.recordSend(success)

        // 发送状态通知事件
        windowManager.send(IPC_CHANNELS.tasks.subAccount.accountStatusChanged, account.id, {
          accountId: subAccount.id,
          accountName: subAccount.name,
          message: content,
          timestamp: Date.now(),
        })

        const typingDelay = randomInt(500, 2000)
        await sleep(typingDelay)

        return Result.succeed()
      },
      {
        ...retryOptions,
        logger,
        signal,
        onRetryError: () => {
          logger.info('发送失败，准备重试...')
        },
        shouldRetry: err => !(err instanceof SubAccountVerificationRequiredError),
      },
    )
    return result
  }

  function updateConfig(newConfig: Partial<SubAccountInteractionConfig>) {
    const mergedConfig = { ...config, ...newConfig }
    return Result.pipe(
      validateConfig(mergedConfig),
      Result.andThen(_ => intervalTask.validateInterval(mergedConfig.scheduler.interval)),
      Result.inspect(() => {
        config = mergedConfig
        mergedConfig.accounts.forEach(acc => ensureRateLimiter(acc.platform))
        intervalTask.restart()
      }),
      Result.inspectError(err => logger.error('配置更新失败：', err)),
    )
  }

  intervalTask.addStopListener(() => {
    // 发送账号隔离的停止事件
    windowManager.send(IPC_CHANNELS.tasks.subAccount.stoppedFor(account.id), account.id)
  })

  const task = createTask(
    {
      taskName: TASK_NAME,
      logger,
    },
    {
      onStart: async () => {
        await intervalTask.start()
      },
      onStop: () => {
        intervalTask.stop()
      },
    },
  )

  return Result.pipe(
    validateConfig(config),
    Result.map(() => ({
      ...task,
      updateConfig,
    })),
  )
}

class MessageValidationError extends ErrorFactory({
  name: 'MessageValidationError',
  message: ({ description }) => `消息配置验证失败: ${description}`,
  fields: ErrorFactory.fields<{
    description: string
  }>(),
}) {}

class AccountValidationError extends ErrorFactory({
  name: 'AccountValidationError',
  message: ({ description }) => `小号配置验证失败: ${description}`,
  fields: ErrorFactory.fields<{
    description: string
  }>(),
}) {}
