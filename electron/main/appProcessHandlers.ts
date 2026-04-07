import { createLogger } from './logger'

type ProcessHandlerOptions = {
  isQuitting: () => boolean
  showErrorBox: (title: string, content: string) => void
  writeCrashToTemp: (tag: string, error: unknown) => void
  writeStartupLog: (message: string) => void
}

export function registerAppProcessHandlers({
  isQuitting,
  showErrorBox,
  writeCrashToTemp,
  writeStartupLog,
}: ProcessHandlerOptions) {
  process.on('uncaughtException', error => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : 'No stack trace'
    writeStartupLog('========== uncaughtException ==========')
    writeStartupLog(`uncaughtException 消息: ${errorMsg}`)
    writeStartupLog(`uncaughtException 堆栈: ${errorStack}`)
    writeCrashToTemp('uncaughtException', error)

    const logger = createLogger('uncaughtException')
    logger.error('--------------意外的未捕获异常---------------')
    logger.error(error)
    logger.error('---------------------------------------------')

    if (!isQuitting()) {
      try {
        showErrorBox('应用程序错误', `发生了一个意外的错误，请联系技术支持：\n${error.message}`)
      } catch (dialogError) {
        logger.error('显示错误对话框失败:', dialogError)
      }
    }
  })

  process.on('unhandledRejection', (reason, _promise) => {
    const reasonMsg = reason instanceof Error ? reason.message : String(reason)
    const reasonStack = reason instanceof Error ? reason.stack : 'No stack trace'
    writeStartupLog('========== unhandledRejection ==========')
    writeStartupLog(`unhandledRejection 原因: ${reasonMsg}`)
    writeStartupLog(`unhandledRejection 堆栈: ${reasonStack}`)

    if (
      reason instanceof Error &&
      reason.message.includes('cdpSession.send: Target page, context or browser has been closed')
    ) {
      return createLogger('unhandledRejection').verbose(reason)
    }

    writeCrashToTemp('unhandledRejection', reason)
    const logger = createLogger('unhandledRejection')
    logger.error('--------------未被处理的错误---------------')
    logger.error(reason)
    logger.error('-------------------------------------------')
  })
}
