import { isBrowserClosedReason } from 'shared/liveControlDisconnect'
import type { StreamStateDetector } from '#/services/StreamStateDetector'
import type { SessionLogger } from './accountSessionShared'

export { stopAccountSessionTasksAndUpdateState } from './accountSessionDisconnectOps'

export function isFatalAccountSessionDisconnect(
  reason: string | undefined,
  shouldCloseBrowser: boolean,
) {
  return shouldCloseBrowser || isBrowserClosedReason(reason) || reason?.includes('应用退出')
}

export async function handleAccountSessionStreamEnded(params: {
  accountId: string
  reason: string
  logger: SessionLogger
  streamStateDetector: StreamStateDetector
  keepDetectorAlive?: boolean
  isDisconnecting: () => boolean
  setDisconnecting: (disconnecting: boolean) => void
  stopTasksForStreamEnded: () => Promise<void>
}) {
  const {
    accountId,
    reason,
    logger,
    streamStateDetector,
    keepDetectorAlive = true,
    isDisconnecting,
    setDisconnecting,
    stopTasksForStreamEnded,
  } = params

  if (isDisconnecting()) {
    logger.info(`[stopForStreamEnded] 账号 ${accountId} 已在处理中，跳过`)
    return
  }

  if (!streamStateDetector.isRunning) {
    logger.warn('[stopForStreamEnded] Detector 未运行，尝试重启')
    const restarted = streamStateDetector.keepAlive()
    if (!restarted) {
      logger.error('[stopForStreamEnded] Detector 重启失败，中止关播处理')
      return
    }
  }

  setDisconnecting(true)
  logger.warn(`[stopForStreamEnded][${accountId}] START, reason: ${reason}`)

  await stopTasksForStreamEnded()

  if (!keepDetectorAlive) {
    logger.info('[stopForStreamEnded] 已释放无头浏览器资源，暂停直播状态检测')
    setDisconnecting(false)
    logger.warn(`[stopForStreamEnded][${accountId}] END`)
    return
  }

  if (!streamStateDetector.isRunning) {
    logger.error('[stopForStreamEnded] Detector 意外停止，立即重启')
    streamStateDetector.keepAlive()
  } else {
    logger.info('[stopForStreamEnded] Detector 运行正常，继续监控直播状态')
  }

  setDisconnecting(false)
  logger.warn(`[stopForStreamEnded][${accountId}] END`)
}

export async function disconnectAccountSession(params: {
  accountId: string
  reason?: string
  shouldCloseBrowser: boolean
  logger: SessionLogger
  isDisconnecting: () => boolean
  isDisconnected: () => boolean
  isWaitingForLogin: () => boolean
  setDisconnecting: (disconnecting: boolean) => void
  setDisconnected: (disconnected: boolean) => void
  setWaitingForLogin: (waiting: boolean) => void
  activeTasksCount: () => number
  stopTasksForDisconnect: (disconnectReason: string, shouldCloseBrowser: boolean) => Promise<void>
}) {
  const {
    accountId,
    reason,
    shouldCloseBrowser,
    logger,
    isDisconnecting,
    isDisconnected,
    isWaitingForLogin,
    setDisconnecting,
    setDisconnected,
    setWaitingForLogin,
    activeTasksCount,
    stopTasksForDisconnect,
  } = params

  if (isDisconnecting() || isDisconnected()) {
    logger.info(`[disconnect] 账号 ${accountId} 已经在断开中或已断开，跳过`)
    return
  }

  const isFatalDisconnect = isFatalAccountSessionDisconnect(reason, shouldCloseBrowser)
  if (isWaitingForLogin() && !isFatalDisconnect) {
    logger.info(`[disconnect][${accountId}] 等待登录阶段，忽略非致命断开: ${reason || '无原因'}`)
    setWaitingForLogin(false)
    return
  }

  setDisconnecting(true)
  setWaitingForLogin(false)
  const disconnectReason = reason || '与中控台断开连接'

  logger.warn(
    `[disconnect][${accountId}] START disconnect, reason: ${disconnectReason}, closeBrowser: ${shouldCloseBrowser}`,
  )
  logger.warn(`[disconnect][${accountId}] activeTasks count: ${activeTasksCount()}`)

  try {
    await stopTasksForDisconnect(disconnectReason, shouldCloseBrowser)
    setDisconnected(true)
    logger.warn(`[disconnect][${accountId}] END`)
  } catch (error) {
    logger.error(`[disconnect][${accountId}] FAILED`, error)
    throw error
  } finally {
    setDisconnecting(false)
  }
}
