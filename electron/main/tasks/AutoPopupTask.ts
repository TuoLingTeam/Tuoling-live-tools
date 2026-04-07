import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AbortError } from '#/errors/AppError'
import {
  ElementDisabledError,
  ElementNotFoundError,
  MaxTryCountExceededError,
} from '#/errors/PlatformError'
import type { ScopedLogger } from '#/logger'
import type { IPerformPopup } from '#/platforms/IPlatform'
import { mergeWithoutArray, randomInt, takeScreenshot } from '#/utils'
import windowManager from '#/windowManager'
import { createIntervalTask } from './IntervalTask'
import { runWithRetry } from './retry'

const TASK_NAME = '自动弹窗'

const retryOptions = {
  maxRetries: 3,
  retryDelay: 1000,
}

function isSkippableAutoPopupError(error: unknown): boolean {
  if (error instanceof MaxTryCountExceededError) {
    return (
      (error as { taskName?: string }).taskName === '查找商品' || error.message.includes('查找商品')
    )
  }

  if (error instanceof ElementNotFoundError || error instanceof ElementDisabledError) {
    const elementName = (error as { elementName?: string }).elementName ?? ''
    return (
      elementName.includes('商品') ||
      elementName.includes('讲解按钮') ||
      elementName.includes('弹品按钮') ||
      error.message.includes('商品') ||
      error.message.includes('讲解按钮') ||
      error.message.includes('弹品按钮')
    )
  }

  return false
}

/**
 * 【P1-3 按商品设置弹窗时间】创建自动弹窗任务
 * 支持每个商品单独设置弹窗间隔
 */
export function createAutoPopupTask(
  platform: IPerformPopup,
  taskConfig: AutoPopupConfig,
  account: Account,
  _logger: ScopedLogger,
) {
  const logger = _logger.scope(TASK_NAME)
  let arrayIndex = -1
  let config = { ...normalizeConfig(taskConfig) }

  const intervalTaskResult = createIntervalTask(execute, {
    interval: config.scheduler.interval,
    taskName: TASK_NAME,
    logger,
  })

  if (Result.isFailure(intervalTaskResult)) {
    return intervalTaskResult
  }

  const intervalTask = intervalTaskResult.value

  async function execute(signal: AbortSignal) {
    if (signal.aborted) {
      return Result.fail(new AbortError())
    }

    const { goodsId, interval } = getNextGoodsConfig()

    // 【P1-3】设置下一次执行的间隔（如果该商品有单独配置）
    if (interval) {
      intervalTask.setNextInterval(interval)
    }

    const result = await runWithRetry(
      async () => {
        if (signal.aborted) {
          return Result.fail(new AbortError())
        }

        const result = await platform.performPopup(goodsId, signal)
        if (Result.isSuccess(result)) {
          logger.success(`商品 ${goodsId} 讲解成功`)
        }
        return result
      },
      {
        ...retryOptions,
        logger,
        signal,
        onRetryError: error => {
          if (isSkippableAutoPopupError(error)) {
            return
          }
          const page = platform.getPopupPage()
          if (page) takeScreenshot(page, TASK_NAME, account.name)
        },
        shouldRetry: error => !isSkippableAutoPopupError(error),
      },
    )

    if (Result.isFailure(result) && isSkippableAutoPopupError(result.error)) {
      logger.warn(`商品 ${goodsId} 当前无法定位或讲解，已跳过本轮：`, result.error)
      return Result.succeed()
    }

    return result
  }

  /**
   * 【P1-3】获取下一个商品配置
   * 返回商品ID和该商品特定的间隔（如果有）
   */
  function getNextGoodsConfig(): { goodsId: number; interval?: [number, number] } {
    const goodsList = config.goods

    if (config.random) {
      arrayIndex = randomInt(0, goodsList.length - 1)
    } else {
      arrayIndex = (arrayIndex + 1) % goodsList.length
    }

    const goodsItem = goodsList[arrayIndex]
    return {
      goodsId: goodsItem.id,
      interval: goodsItem.interval,
    }
  }

  function validateConfig(userConfig: AutoPopupConfig) {
    const normalizedConfig = normalizeConfig(userConfig)
    return Result.pipe(
      intervalTask.validateInterval(normalizedConfig.scheduler.interval),
      Result.andThen(() => {
        if (normalizedConfig.goods.length === 0)
          return Result.fail(new Error('商品配置验证失败: 必须提供至少一个商品ID'))
        return Result.succeed()
      }),
      Result.inspect(() => {
        // 统计有单独间隔配置的商品
        const customIntervalCount = normalizedConfig.goods.filter(g => g.interval).length
        logger.info(
          `商品配置验证通过，共加载 ${normalizedConfig.goods.length} 个商品，其中 ${customIntervalCount} 个设置了单独间隔`,
        )
      }),
    )
  }

  /**
   * 【P1-3】配置标准化
   * 兼容旧配置（goodsIds）和新配置（goods）
   */
  function normalizeConfig(userConfig: AutoPopupConfig & { goodsIds?: number[] }): AutoPopupConfig {
    // 如果已有 goods 配置，直接使用
    if (userConfig.goods && userConfig.goods.length > 0) {
      return userConfig
    }
    // 【兼容旧配置】将 goodsIds 转换为 goods
    if (userConfig.goodsIds && userConfig.goodsIds.length > 0) {
      return {
        ...userConfig,
        goods: userConfig.goodsIds.map(id => ({ id })),
      }
    }
    // 返回带空数组的配置
    return {
      ...userConfig,
      goods: [],
    }
  }

  /**
   * 【P1-2 运行时配置热更新】更新配置
   *
   * 可热更新项（无需重启任务）：
   * - goods: 商品配置列表（立即生效，下一个商品使用新配置）
   * - random: 随机弹窗模式（立即生效）
   * - scheduler.interval: 弹窗间隔（下一个周期生效）
   *
   * 仍需重启项（变更后需重启任务）：
   * - 无（所有配置都支持热更新）
   */
  function updateConfig(newConfig: Partial<AutoPopupConfig>) {
    const mergedConfig = mergeWithoutArray(config, newConfig)
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
        if (newConfig.goods) changedFields.push('goods')
        if (newConfig.random !== undefined) changedFields.push('random')
        if (newConfig.scheduler?.interval) changedFields.push('interval')

        logger.info(`[热更新] 配置已更新: [${changedFields.join(', ')}]，无需重启任务`)
      }),
      Result.inspectError(err => logger.error('配置更新失败：', err)),
    )
  }

  intervalTask.addStopListener(() => {
    // 发送账号隔离的停止事件
    windowManager.send(IPC_CHANNELS.tasks.autoPopUp.stoppedFor(account.id), account.id)
  })

  return Result.pipe(
    validateConfig(config),
    Result.map(_ => ({
      ...intervalTask,
      updateConfig,
    })),
  )
}
