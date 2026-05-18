import { Result } from '@praha/byethrow'
import { SUB_ACCOUNT_WORKSPACE_NAME } from 'shared/subAccountWorkspace'
import { createLogger } from '#/logger'
import type { ITask } from '#/tasks/ITask'
import { createSubAccountInteractionTask } from '#/tasks/SubAccountInteractionTask'

/**
 * 小号互动任务管理器
 * 独立于 AccountSession，允许用户在不连接直播中控台的情况下使用小号互动
 */
class SubAccountTaskManager {
  private tasks: Map<string, ITask> = new Map()
  private logger = createLogger('SubAccountTaskManager')

  async start(accountId: string, config: SubAccountInteractionConfig): Promise<boolean> {
    if (this.tasks.has(accountId)) {
      this.logger.warn(`小号互动任务已存在: ${accountId}`)
      return true
    }

    const account: Account = {
      id: accountId,
      name: SUB_ACCOUNT_WORKSPACE_NAME,
    }
    const lgr = createLogger(`@${account.name}`)
    const result = createSubAccountInteractionTask(config, account, lgr)

    if (Result.isFailure(result)) {
      this.logger.error('创建小号互动任务失败:', result.error)
      return false
    }

    const task = result.value
    task.addStopListener(() => {
      this.tasks.delete(accountId)
    })

    await task.start()
    this.tasks.set(accountId, task)
    return true
  }

  stop(accountId: string): boolean {
    const task = this.tasks.get(accountId)
    if (!task) {
      return true
    }
    task.stop()
    return true
  }

  updateConfig(
    accountId: string,
    newConfig: Partial<SubAccountInteractionConfig>,
  ): Result.Result<void, Error> {
    const task = this.tasks.get(accountId)
    if (!task?.updateConfig) {
      return Result.fail(new Error('任务不存在或不支持更新配置'))
    }
    return task.updateConfig(newConfig)
  }

  getTask(accountId: string): ITask | undefined {
    return this.tasks.get(accountId)
  }

  isRunning(accountId: string): boolean {
    const task = this.tasks.get(accountId)
    return task?.isRunning() ?? false
  }

  cleanup(): void {
    for (const [accountId, task] of this.tasks.entries()) {
      try {
        task.stop()
      } catch (error) {
        this.logger.error(`清理小号互动任务失败: ${accountId}`, error)
      }
    }
    this.tasks.clear()
  }
}

export const subAccountTaskManager = new SubAccountTaskManager()
