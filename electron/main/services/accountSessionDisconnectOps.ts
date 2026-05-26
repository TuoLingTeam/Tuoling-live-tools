import { IPC_CHANNELS } from 'shared/ipcChannels'
import { type BrowserSession, browserManager } from '#/managers/BrowserSessionManager'
import { accountRuntimeManager } from '#/services/AccountScopedRuntimeManager'
import type { StreamStateDetector } from '#/services/StreamStateDetector'
import type { ITask } from '#/tasks/ITask'
import windowManager from '#/windowManager'
import { isBenignCloseError } from './accountSessionBrowser'
import type { EmitConnectionState, SessionLogger, WithTimeout } from './accountSessionShared'

const BROWSER_CLOSE_TIMEOUT_MS = 10_000

async function closeAccountSessionBrowserSession(params: {
  getBrowserSession: () => BrowserSession | null
  setBrowserSession: (session: BrowserSession | null) => void
  streamStateDetector: StreamStateDetector
  logger: SessionLogger
  withTimeout: WithTimeout
}) {
  const { getBrowserSession, setBrowserSession, streamStateDetector, logger, withTimeout } = params
  const session = getBrowserSession()

  if (!session) {
    logger.info('[disconnect] Browser session already cleared, skipping browser shutdown')
    streamStateDetector.updateBrowserSession(null)
    return
  }

  const { page, context } = session
  let closeError: unknown

  try {
    if (!page.isClosed()) {
      await withTimeout(
        page.close().catch(error => {
          if (!isBenignCloseError(error)) {
            throw error
          }
        }),
        BROWSER_CLOSE_TIMEOUT_MS,
        '关闭页面超时，请重试',
      )
    }
  } catch (error) {
    closeError = error
    logger.warn('[disconnect] 关闭页面失败，将继续尝试关闭上下文/浏览器：', error)
  }

  try {
    await withTimeout(
      context.close().catch(error => {
        if (!isBenignCloseError(error)) {
          throw error
        }
      }),
      BROWSER_CLOSE_TIMEOUT_MS,
      '关闭浏览器上下文超时，请重试',
    )
  } catch (error) {
    closeError = error
    logger.warn('[disconnect] 关闭浏览器上下文失败，将继续尝试释放浏览器：', error)
  }

  try {
    await withTimeout(
      browserManager.releaseSessionBrowser(session).catch(error => {
        if (!isBenignCloseError(error)) {
          throw error
        }
      }),
      BROWSER_CLOSE_TIMEOUT_MS,
      '关闭浏览器超时，请重试',
    )
  } catch (error) {
    closeError = error
    logger.error('[disconnect] 无法释放浏览器：', error)
  }

  if (closeError) {
    logger.warn('[disconnect] 浏览器关闭存在异常，已继续清理会话状态：', closeError)
  }

  setBrowserSession(null)
  streamStateDetector.updateBrowserSession(null)
  logger.info(
    closeError
      ? '[disconnect] Browser session state cleared after close errors'
      : '[disconnect] Browser session closed cleanly',
  )
}

export async function stopAccountSessionTasksAndUpdateState(params: {
  accountId: string
  reason: string
  closeBrowser: boolean
  sendDisconnectEvent: boolean
  stopDetector?: boolean
  activeTasks: Map<LiveControlTask['type'], ITask>
  streamStateDetector: StreamStateDetector
  logger: SessionLogger
  emitConnectionState: EmitConnectionState
  withTimeout: WithTimeout
  getBrowserSession: () => BrowserSession | null
  setBrowserSession: (session: BrowserSession | null) => void
}) {
  const {
    accountId,
    reason,
    closeBrowser,
    sendDisconnectEvent,
    stopDetector = false,
    activeTasks,
    streamStateDetector,
    logger,
    emitConnectionState,
    withTimeout,
    getBrowserSession,
    setBrowserSession,
  } = params

  if (stopDetector) {
    logger.info(
      `[disconnect][${accountId}] >>> Step 1a: stopping streamStateDetector (stopDetector=true)`,
    )
    streamStateDetector.stop()
  } else {
    logger.info(
      `[disconnect][${accountId}] >>> Step 1a: NOT stopping streamStateDetector (stopDetector=false), keeping for re-detection`,
    )
  }
  streamStateDetector.setState('offline')

  logger.info(`[disconnect][${accountId}] >>> Step 2: stopping ${activeTasks.size} active tasks`)
  const activeTaskEntries = Array.from(activeTasks.entries())
  for (const [index, [taskType, task]] of activeTaskEntries.entries()) {
    logger.info(
      `[disconnect][${accountId}] >>> Stopping task ${index + 1}/${activeTaskEntries.length}: ${taskType}`,
    )
    try {
      await task.stop()
    } catch (error) {
      logger.warn(`[disconnect][${accountId}] >>> Task ${taskType} stop error (ignored):`, error)
    }
  }
  activeTasks.clear()
  logger.info(`[disconnect][${accountId}] >>> Step 3: activeTasks cleared`)

  if (closeBrowser) {
    logger.info(`[disconnect][${accountId}] >>> Step 4: closing browser session`)
    await closeAccountSessionBrowserSession({
      getBrowserSession,
      setBrowserSession,
      streamStateDetector,
      logger,
      withTimeout,
    })
  } else {
    logger.info(`[disconnect][${accountId}] >>> Step 4: NOT closing browser`)
  }

  accountRuntimeManager.setStreamState(accountId, 'offline')

  if (sendDisconnectEvent) {
    logger.info(`[disconnect][${accountId}] >>> Step 5: sending disconnectedEvent`)
    emitConnectionState({
      status: 'disconnected',
      phase: 'idle',
      error: reason || null,
      session: null,
      lastVerifiedAt: null,
    })
    windowManager.send(IPC_CHANNELS.tasks.liveControl.disconnectedEvent, accountId, reason)
    accountRuntimeManager.setDisconnected(accountId)
    return
  }

  logger.info(
    `[disconnect][${accountId}] >>> Step 5: sending streamStateChanged (stream ended, not disconnected)`,
  )
  windowManager.send(IPC_CHANNELS.tasks.liveControl.streamStateChanged, accountId, 'offline')
}
