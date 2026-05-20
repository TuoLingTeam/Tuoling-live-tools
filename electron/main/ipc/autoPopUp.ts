import { Result } from '@praha/byethrow'
import { globalShortcut } from 'electron'
import { throttle } from 'lodash-es'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { typedIpcMainHandle } from '#/utils'

const TASK_NAME = '自动弹窗'
const TASK_TYPE = 'auto-popup'
const registeredShortcutMap = new Map<string, string[]>()

function unregisterAccountShortcuts(accountId: string) {
  const accelerators = registeredShortcutMap.get(accountId)
  if (!accelerators) {
    return
  }

  for (const accelerator of accelerators) {
    globalShortcut.unregister(accelerator)
  }
  registeredShortcutMap.delete(accountId)
}

// IPC 处理程序
function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.start, async (_, accountId, config) => {
    return await Result.pipe(
      accountManager.getSession(accountId),
      Result.andThen(accountSession => accountSession.startTask({ type: TASK_TYPE, config })),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('启动任务失败：', error)
      }),
      r => r.then(Result.isSuccess),
    )
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.stop, async (_, accountId) => {
    return Result.pipe(
      accountManager.getSession(accountId),
      Result.inspect(accountSession => accountSession.stopTask(TASK_TYPE)),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('停止任务失败：', error)
      }),
      r => Result.isSuccess(r),
    )
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.updateConfig, async (_, accountId, newConfig) => {
    const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
    Result.pipe(
      accountManager.getSession(accountId),
      Result.andThen(accountSession => accountSession.updateTaskConfig(TASK_TYPE, newConfig)),
      Result.inspect(_ => logger.info('更新配置成功')),
      Result.inspectError(error => logger.error('更新配置失败：', error)),
    )
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.fetchGoodsIds, async (_, accountId) => {
    const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
    const accountSession = accountManager.getSession(accountId)
    if (Result.isFailure(accountSession)) {
      logger.error('读取商品序号失败：', accountSession.error)
      return {
        success: false,
        error:
          accountSession.error instanceof Error ? accountSession.error.message : '读取商品序号失败',
      }
    }

    const goodsMetaResult = await accountSession.value.fetchAutoPopupGoodsMeta()
    if (Result.isSuccess(goodsMetaResult) && goodsMetaResult.value.length > 0) {
      const goodsMetaById = new Map(goodsMetaResult.value.map(item => [item.id, item]))
      const goodsMeta = [...goodsMetaById.values()].sort((a, b) => a.id - b.id)
      const goodsIds = goodsMeta.map(item => item.id)
      logger.info(`成功读取商品序号，共 ${goodsIds.length} 个（含商品标题）`)
      return {
        success: true,
        goodsIds,
        goods: goodsMeta,
      }
    }

    const goodsIdsResult = await accountSession.value.fetchAutoPopupGoodsIds()
    if (Result.isFailure(goodsIdsResult)) {
      logger.error('读取商品序号失败：', goodsIdsResult.error)
      return {
        success: false,
        error:
          goodsIdsResult.error instanceof Error ? goodsIdsResult.error.message : '读取商品序号失败',
      }
    }

    const goodsMeta = Result.isSuccess(goodsMetaResult) ? goodsMetaResult.value : undefined

    logger.info(`成功读取商品序号，共 ${goodsIdsResult.value.length} 个`)
    return {
      success: true,
      goodsIds: goodsIdsResult.value,
      goods: goodsMeta,
    }
  })

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoPopUp.scanGoodsKnowledge,
    async (_, accountId, goodsId) => {
      const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
      const accountSession = accountManager.getSession(accountId)
      if (Result.isFailure(accountSession)) {
        logger.error('扫描商品知识失败：', accountSession.error)
        return {
          success: false,
          error:
            accountSession.error instanceof Error
              ? accountSession.error.message
              : '扫描商品知识失败',
        }
      }

      const scanResult = await accountSession.value.scanAutoPopupGoodsKnowledge(goodsId)
      if (Result.isFailure(scanResult)) {
        logger.error('扫描商品知识失败：', scanResult.error)
        return {
          success: false,
          error: scanResult.error instanceof Error ? scanResult.error.message : '扫描商品知识失败',
        }
      }

      return {
        success: true,
        data: scanResult.value,
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.registerShortcuts, (_, accountId, shortcuts) => {
    const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope('快捷键弹窗')
    unregisterAccountShortcuts(accountId)

    const registeredAccelerators: string[] = []
    for (const sc of shortcuts) {
      const registered = globalShortcut.register(
        sc.accelerator,
        throttle(
          () => {
            Result.pipe(
              accountManager.getSession(accountId),
              Result.andThen(accountSession =>
                accountSession.updateTaskConfig(TASK_TYPE, {
                  goods: sc.goodsIds.map(id => ({ id })),
                }),
              ),
              Result.inspect(_ => logger.info(`切换到商品组[${sc.goodsIds.join(',')}]`)),
              Result.inspectError(error => {
                logger.error('切换失败：', error)
              }),
            )
          },
          1000,
          { trailing: false },
        ),
      )
      if (registered) {
        registeredAccelerators.push(sc.accelerator)
      } else {
        logger.warn(`快捷键注册失败，可能已被占用: ${sc.accelerator}`)
      }
    }

    if (registeredAccelerators.length > 0) {
      registeredShortcutMap.set(accountId, registeredAccelerators)
    }
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoPopUp.unregisterShortcuts, (_, accountId) => {
    unregisterAccountShortcuts(accountId)
  })
}

export function setupAutoPopUpIpcHandlers() {
  setupIpcHandlers()
}
