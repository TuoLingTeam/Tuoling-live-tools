import process from 'node:process'
import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import {
  isBrowserClosedReason,
  LIVE_CONTROL_DISCONNECT_REASONS,
  normalizeLiveControlDisconnectReason,
} from 'shared/liveControlDisconnect'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { typedIpcMainHandle } from '#/utils'
import windowManager from '#/windowManager'

const TASK_NAME = '中控台'

/** 主进程允许同时连接的最大账号数，避免内存与 FD 耗尽 */
const MAX_CONCURRENT_ACCOUNTS = 10

let browserSessionManagerPromise: Promise<
  typeof import('#/managers/BrowserSessionManager')
> | null = null

async function getBrowserManager() {
  if (!browserSessionManagerPromise) {
    browserSessionManagerPromise = import('#/managers/BrowserSessionManager')
  }
  return (await browserSessionManagerPromise).browserManager
}

function emitConnectionState(
  accountId: string,
  connectState: {
    status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
    phase:
      | 'idle'
      | 'preparing'
      | 'recovering'
      | 'launching_browser'
      | 'waiting_for_login'
      | 'verifying_session'
      | 'streaming'
      | 'tasks_running'
      | 'error'
    error?: string | null
    session?: string | null
    lastVerifiedAt?: number | null
  },
) {
  windowManager.send(IPC_CHANNELS.tasks.liveControl.stateChanged, {
    accountId,
    connectState,
  })
}

function setupIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.liveControl.connect,
    async (_, { browserPath, headless, storageState, platform, account, traceId }) => {
      const logPrefix = traceId ? `[conn][${account.id}][${traceId}]` : `[conn][${account.id}]`
      const logger = createLogger(`@${account.name}`).scope(TASK_NAME)

      console.log(`[BrowserPopup] ${logPrefix} IPC received`, {
        platform,
        headless,
        hasBrowserPath: !!browserPath,
        hasStorageState: !!storageState,
      })

      try {
        const currentCount = accountManager.accountSessions.size
        if (currentCount >= MAX_CONCURRENT_ACCOUNTS) {
          const msg = `同时连接账号数已达上限（${MAX_CONCURRENT_ACCOUNTS}），请先断开部分账号再连接`
          console.warn(
            `[BrowserPopup] ${logPrefix} MAX_CONCURRENT_ACCOUNTS reached: ${currentCount}`,
          )
          createLogger(TASK_NAME).warn(msg)
          emitConnectionState(account.id, {
            status: 'error',
            phase: 'error',
            error: msg,
            session: null,
            lastVerifiedAt: null,
          })
          return {
            success: false,
            browserLaunched: false,
            error: msg,
          }
        }

        if (browserPath) {
          ;(await getBrowserManager()).setBrowserPath(browserPath)
        }

        logger.info(
          `${logPrefix}[connect:start] platform=${platform} account=${account.name} headless=${headless}`,
        )

        const accountSession = await accountManager.createSession(platform, account)

        console.log(`[BrowserPopup] ${logPrefix} Session created, calling connect()`)

        const mem = process.memoryUsage()
        createLogger(TASK_NAME).info(
          `${logPrefix}[资源] 当前连接数=${accountManager.accountSessions.size} heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)}MB rss=${Math.round(mem.rss / 1024 / 1024)}MB`,
        )

        createLogger(TASK_NAME).info(`${logPrefix}[connect:launching] headless 参数：${headless}`)
        try {
          console.log(
            `[BrowserPopup] ${logPrefix} Calling accountSession.connect() with headless=${headless}`,
          )

          const connectResult = await accountSession.connect({
            headless,
            storageState,
          })

          console.log(`[BrowserPopup] ${logPrefix} connect() returned`, {
            needsLogin: connectResult.needsLogin,
          })
          logger.info(`${logPrefix}[connect:async-started] returning browserLaunched=true`)
          return {
            success: true,
            browserLaunched: true,
            needsLogin: connectResult.needsLogin,
          }
        } catch (error) {
          console.error(
            `[BrowserPopup] ${logPrefix} connect() threw error:`,
            error instanceof Error ? error.message : error,
          )
          logger.error(
            `${logPrefix}[connect:sync-failed] elapsed=0ms error=${error instanceof Error ? error.message : '未知错误'}`,
          )

          // 检查错误类型：如果是浏览器启动失败，不应该返回 browserLaunched=true
          const errorMessage = error instanceof Error ? error.message : ''
          const normalizedErrorMessage = normalizeLiveControlDisconnectReason(errorMessage)
          const isBrowserLaunchError =
            errorMessage.includes('playwright') ||
            errorMessage.includes('无法启动浏览器') ||
            errorMessage.includes('chromium') ||
            errorMessage.includes('Chrome')

          if (isBrowserLaunchError) {
            // 浏览器启动失败，清理 session 并返回失败
            logger.error(
              `${logPrefix}[connect:browser-launch-failed] 浏览器启动失败，不返回 browserLaunched=true`,
            )
            accountManager.accountSessions.delete(account.id)
            emitConnectionState(account.id, {
              status: 'error',
              phase: 'error',
              error: errorMessage || '浏览器启动失败',
              session: null,
              lastVerifiedAt: null,
            })

            return {
              success: false,
              browserLaunched: false,
              error: errorMessage || '浏览器启动失败',
            }
          }

          // 检查 session 是否仍然存在（浏览器可能已启动但登录过程中断）
          const sessionExists = accountManager.accountSessions.has(account.id)

          if (sessionExists) {
            // 浏览器已启动，但登录过程中断（如用户关闭浏览器）
            // 清理 session 但返回 browserLaunched=true，让前端知道浏览器已经弹出过
            logger.info(
              `${logPrefix}[connect:browser-was-launched] session still exists, cleaning up and returning browserLaunched=true`,
            )
            await accountManager.closeSession(
              account.id,
              normalizedErrorMessage || LIVE_CONTROL_DISCONNECT_REASONS.browserClosed,
              { closeBrowser: true },
            )

            return {
              success: true,
              browserLaunched: true,
              needsLogin: true,
            }
          }

          if (isBrowserClosedReason(normalizedErrorMessage)) {
            windowManager.send(
              IPC_CHANNELS.tasks.liveControl.disconnectedEvent,
              account.id,
              LIVE_CONTROL_DISCONNECT_REASONS.browserClosed,
            )
            emitConnectionState(account.id, {
              status: 'disconnected',
              phase: 'idle',
              error: LIVE_CONTROL_DISCONNECT_REASONS.browserClosed,
              session: null,
              lastVerifiedAt: null,
            })

            return {
              success: true,
              browserLaunched: true,
              needsLogin: true,
            }
          }

          // 浏览器未启动，真正失败
          windowManager.send(
            IPC_CHANNELS.tasks.liveControl.disconnectedEvent,
            account.id,
            normalizedErrorMessage || '连接直播控制台失败',
          )
          emitConnectionState(account.id, {
            status: 'error',
            phase: 'error',
            error: normalizedErrorMessage || '连接失败',
            session: null,
            lastVerifiedAt: null,
          })

          return {
            success: false,
            browserLaunched: false,
            error: normalizedErrorMessage || '连接失败',
          }
        }
      } catch (error) {
        logger.warn(
          `${logPrefix}[connect:error] error=${error instanceof Error ? error.message : '启动浏览器时出现问题'}`,
        )
        emitConnectionState(account.id, {
          status: 'error',
          phase: 'error',
          error: error instanceof Error ? error.message : '启动浏览器时出现问题',
          session: null,
          lastVerifiedAt: null,
        })
        return {
          success: false,
          browserLaunched: false,
          error: error instanceof Error ? error.message : '启动浏览器时出现问题',
        }
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.liveControl.disconnect, async (_, accountId: string) => {
    try {
      // 用户主动断开时同步回收旧浏览器会话，避免下次连接复用残留页面
      await accountManager.closeSession(accountId, '用户主动断开', { closeBrowser: true })
      return true
    } catch (error) {
      const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
      logger.error('断开连接失败:', error)
      return false
    }
  })

  // 获取直播间 URL（用于小号互动自动填入）
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.liveControl.getLiveRoomUrl,
    async (_, accountId: string) => {
      try {
        const sessionResult = accountManager.getSession(accountId)
        if (Result.isFailure(sessionResult)) {
          return { success: false, error: '账号未连接' }
        }
        const session = sessionResult.value

        // 使用新的 getLiveRoomUrl 方法，支持从中控台提取直播间链接
        const result = await session.getLiveRoomUrl()
        return result
      } catch (error) {
        const logger = createLogger(TASK_NAME)
        logger.error('获取直播间 URL 失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '获取直播间 URL 失败',
        }
      }
    },
  )
}

export function setupLiveControlIpcHandlers() {
  setupIpcHandlers()
}
