import { createLogger } from './logger'

type ProcessHandlerOptions = {
  isQuitting: () => boolean
  showErrorBox: (title: string, content: string) => void
  writeCrashToTemp: (tag: string, error: unknown) => void
  writeStartupLog: (message: string) => void
}

function isWriteEioError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'syscall' in error &&
      (error as NodeJS.ErrnoException).code === 'EIO' &&
      (error as NodeJS.ErrnoException).syscall === 'write',
  )
}

export function registerAppProcessHandlers({
  isQuitting,
  showErrorBox,
  writeCrashToTemp,
  writeStartupLog,
}: ProcessHandlerOptions) {
  let isHandlingFatalError = false

  process.on('uncaughtException', error => {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : 'No stack trace'
    const logger = createLogger('uncaughtException')
    const isWriteError = isWriteEioError(error)

    try {
      writeCrashToTemp('uncaughtException', error)
    } catch {
      // 忽略 crash 文件写入失败
    }

    // 控制台写失败时，继续走 logger / console / dialog 很容易再次触发 write EIO，直接降级退出。
    if (isWriteError) {
      return
    }

    try {
      writeStartupLog('========== uncaughtException ==========')
      writeStartupLog(`uncaughtException 消息: ${errorMsg}`)
      writeStartupLog(`uncaughtException 堆栈: ${errorStack}`)
    } catch {
      // 忽略启动日志写入失败，避免异常处理再次抛错
    }

    try {
      logger.error('--------------意外的未捕获异常---------------')
      logger.error(error)
      logger.error('---------------------------------------------')
    } catch {
      // 忽略 logger 二次失败
    }

    if (!isQuitting() && !isHandlingFatalError) {
      isHandlingFatalError = true
      try {
        showErrorBox('应用程序错误', `发生了一个意外的错误，请联系技术支持：\n${errorMsg}`)
      } catch (dialogError) {
        try {
          logger.error('显示错误对话框失败:', dialogError)
        } catch {
          // 忽略
        }
      } finally {
        setTimeout(() => {
          isHandlingFatalError = false
        }, 1000)
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
