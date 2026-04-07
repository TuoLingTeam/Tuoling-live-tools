import { Result } from '@praha/byethrow'
import { TaskNotSupportedError } from '#/errors/AppError'
import type { createLogger } from '#/logger'
import type { IPlatform } from '#/platforms/IPlatform'
import { isPerformPopup, isPopupGoodsScanner } from '#/platforms/IPlatform'
import { taskRuntimeMonitor } from '#/services/TaskRuntimeMonitor'
import { type ITask, TaskStopReason } from '#/tasks/ITask'
import { makeAccountSessionTask } from './accountSessionTaskFactory'

type SessionLogger = ReturnType<typeof createLogger>

export async function startAccountSessionTask(params: {
  activeTasks: Map<LiveControlTask['type'], ITask>
  task: LiveControlTask
  platform: IPlatform
  account: Account
  logger: SessionLogger
}): Promise<Result.Result<void, Error>> {
  const { activeTasks, task, platform, account, logger } = params
  const existingTask = activeTasks.get(task.type)
  if (existingTask) {
    if (existingTask.isRunning()) {
      logger.info(
        `[startTask][${account.id}] Task ${task.type} already running, reusing existing instance`,
      )
      if (task.config && existingTask.updateConfig) {
        const updateResult = existingTask.updateConfig(task.config as never)
        if (Result.isFailure(updateResult)) {
          return updateResult
        }
      }
      return Result.succeed()
    }

    logger.warn(
      `[startTask][${account.id}] Found stale task instance for ${task.type}, replacing it`,
    )
    activeTasks.delete(task.type)
  }

  const newTask = makeAccountSessionTask(task, platform, account, logger)
  if (Result.isFailure(newTask)) {
    return newTask
  }

  let runtimeMonitorTaskId: string | null = null
  await newTask.value.start()

  if (!newTask.value.isRunning()) {
    const lastStop = newTask.value.getLastStopInfo()
    if (lastStop.reason === TaskStopReason.COMPLETED) {
      logger.info(
        `[startTask][${account.id}] Task ${task.type} completed during startup, treating as success`,
      )
      return Result.succeed()
    }
    if (lastStop.reason === TaskStopReason.ERROR) {
      const taskError =
        lastStop.error instanceof Error
          ? lastStop.error
          : new Error(`任务 ${task.type} 启动失败：任务执行出错`)
      logger.error(
        `[startTask][${account.id}] Task ${task.type} failed during startup:`,
        lastStop.error,
      )
      return Result.fail(taskError)
    }
    logger.error(
      `[startTask][${account.id}] Task ${task.type} failed to start: isRunning() returned false after start()`,
    )
    return Result.fail(new Error(`任务 ${task.type} 启动失败：任务未进入运行状态`))
  }

  runtimeMonitorTaskId = taskRuntimeMonitor.registerTask(account.id, task.type)
  newTask.value.addStopListener(() => {
    activeTasks.delete(task.type)
    if (runtimeMonitorTaskId) {
      taskRuntimeMonitor.unregisterTask(runtimeMonitorTaskId)
    }
  })

  activeTasks.set(task.type, newTask.value)

  const stats = taskRuntimeMonitor.getStatistics()
  logger.info(
    `[startTask][${account.id}] Task ${task.type} started successfully, running tasks: ${stats.runningTasks}, timers: ${stats.activeTimers}, listeners: ${stats.activeListeners}`,
  )

  return Result.succeed()
}

export function stopAccountSessionTask(params: {
  activeTasks: Map<LiveControlTask['type'], ITask>
  taskType: LiveControlTask['type']
  accountId: string
  logger: SessionLogger
}) {
  const { activeTasks, taskType, accountId, logger } = params
  const task = activeTasks.get(taskType)
  if (task) {
    if (!task.isRunning()) {
      logger.info(
        `[stopTask][${accountId}] Task ${taskType} is already stopped (isRunning=false), skipping stop call`,
      )
      activeTasks.delete(taskType)
      return
    }

    logger.info(`[stopTask][${accountId}] Stopping task ${taskType}...`)
    task.stop()

    const stats = taskRuntimeMonitor.getStatistics()
    logger.info(
      `[stopTask][${accountId}] Task ${taskType} stopped, running tasks: ${stats.runningTasks}, timers: ${stats.activeTimers}, listeners: ${stats.activeListeners}`,
    )
  } else {
    logger.info(
      `[stopTask][${accountId}] Task ${taskType} not found in activeTasks, considering already stopped`,
    )
  }
}

export function updateAccountSessionTaskConfig<T extends LiveControlTask>(
  activeTasks: Map<LiveControlTask['type'], ITask>,
  type: T['type'],
  config: Partial<T['config']>,
): Result.Result<void, Error> {
  const task = activeTasks.get(type)
  if (task?.updateConfig) {
    return task.updateConfig(config)
  }
  return Result.fail(new TaskNotSupportedError({ taskName: `update-${type}` }))
}

export function getActiveAccountSessionTaskTypes(
  activeTasks: Map<LiveControlTask['type'], ITask>,
): LiveControlTask['type'][] {
  return Array.from(activeTasks.entries())
    .filter(([, task]) => task.isRunning())
    .map(([taskType]) => taskType)
}

export async function fetchAccountSessionAutoPopupGoodsIds(
  platform: IPlatform,
): Promise<Result.Result<number[], Error>> {
  if (!isPerformPopup(platform)) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'auto-popup' }))
  }

  if (!isPopupGoodsScanner(platform)) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'scan-auto-popup-goods' }))
  }

  return await platform.scanPopupGoodsIds()
}

export async function fetchAccountSessionAutoPopupGoodsMeta(
  platform: IPlatform,
): Promise<Result.Result<Array<{ id: number; title?: string }>, Error>> {
  if (!isPerformPopup(platform)) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'auto-popup' }))
  }

  if (!isPopupGoodsScanner(platform) || !platform.scanPopupGoodsMeta) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'scan-auto-popup-goods-meta' }))
  }

  return await platform.scanPopupGoodsMeta()
}

export async function scanAccountSessionAutoPopupGoodsKnowledge(
  platform: IPlatform,
  goodsId: number,
): Promise<
  Result.Result<
    {
      id: number
      title?: string
      priceText?: string
      detailText?: string
      source: 'detail-page' | 'list-item'
    },
    Error
  >
> {
  if (!isPerformPopup(platform)) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'auto-popup' }))
  }

  if (!isPopupGoodsScanner(platform) || !platform.scanPopupGoodsKnowledge) {
    return Result.fail(new TaskNotSupportedError({ taskName: 'scan-auto-popup-goods-knowledge' }))
  }

  return await platform.scanPopupGoodsKnowledge(goodsId)
}
