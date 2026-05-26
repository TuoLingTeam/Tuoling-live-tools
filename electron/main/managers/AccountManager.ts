import { Result } from '@praha/byethrow'
import { ErrorFactory } from '@praha/error-factory'
import { emitter } from '#/event/eventBus'
import { createLogger } from '#/logger'
import type { AccountSession } from '#/services/AccountSession'
import { type ReconnectReason, reconnectManager } from '#/services/ReconnectManager'

class AccountNotFoundError extends ErrorFactory({
  name: 'AccountNotFoundError',
  message: '账号不存在，请先连接中控台',
}) {}

export class AccountManager {
  accountSessions: Map<string, AccountSession> = new Map()
  accountNames: Map<string, string> = new Map()
  private logger = createLogger('账号管理')
  private accountSessionModulePromise: Promise<typeof import('#/services/AccountSession')> | null =
    null
  private cleanupPromise: Promise<void> | null = null
  // 保存事件处理函数引用，用于清理
  private pageClosedHandler: (payload: { accountId: string; reason?: string }) => void

  constructor() {
    this.pageClosedHandler = async ({ accountId, reason }) => {
      try {
        this.logger.info(
          `[page-closed] 收到页面关闭事件，账号: ${accountId}, 原因: ${reason || '未知'}`,
        )

        // 【P0-2 断线自动重连】判断是否需要尝试重连
        // 【高风险修复】reason 缺失或无效时，默认禁止重连（安全第一）
        const validReasons: ReconnectReason[] = [
          'network_error',
          'page_crash',
          'listener_error',
          'user_disconnect',
          'browser_closed',
          'auth_expired',
          'account_switched',
          'stream_ended',
        ]

        let reconnectReason: ReconnectReason
        if (reason && validReasons.includes(reason as ReconnectReason)) {
          reconnectReason = reason as ReconnectReason
        } else {
          // reason 缺失或无效，默认禁止重连
          this.logger.warn(`[page-closed] reason 无效或缺失: ${reason}，默认禁止重连`)
          reconnectReason = 'user_disconnect' // 使用禁止重连的类型作为默认值
        }

        this.logger.info(`[page-closed] 识别到关闭原因: ${reconnectReason}`)

        // 检查是否允许重连
        const shouldReconnect = reconnectManager.shouldReconnect(reconnectReason)
        this.logger.info(
          `[page-closed] shouldReconnect 判断结果: ${shouldReconnect}, 原因: ${reconnectReason}`,
        )

        if (shouldReconnect) {
          this.logger.info(
            `[page-closed] 尝试自动重连，账号: ${accountId}, 原因: ${reconnectReason}`,
          )

          const accountSession = this.accountSessions.get(accountId)
          if (accountSession) {
            // 尝试重连
            const success = await accountSession.reconnect(reconnectReason)

            if (success) {
              this.logger.success(`[page-closed] 自动重连成功，账号: ${accountId}`)
              return // 重连成功，不关闭会话
            }
            this.logger.error(`[page-closed] 自动重连失败，账号: ${accountId}，将关闭会话`)
          }
        } else {
          this.logger.info(`[page-closed] 不允许自动重连，原因: ${reconnectReason}，直接关闭会话`)
        }

        // 重连失败或不允许重连，关闭会话
        this.logger.info(`[page-closed] 执行 closeSession，账号: ${accountId}`)
        await this.closeSession(accountId, reason, { closeBrowser: true })
      } catch (error) {
        this.logger.error(`[page-closed] 处理页面关闭事件失败，账号: ${accountId}`, error)
      }
    }
    emitter.on('page-closed', this.pageClosedHandler)
  }

  private async loadAccountSessionModule() {
    if (!this.accountSessionModulePromise) {
      this.accountSessionModulePromise = import('#/services/AccountSession')
    }
    return this.accountSessionModulePromise
  }

  async createSession(platformName: LiveControlPlatform, account: Account) {
    this.setAccountName(account.id, account.name)
    const existSession = this.accountSessions.get(account.id)
    if (existSession) {
      this.logger.warn('检测到已存在建立的连接，将关闭已建立的连接')
      await this.closeSession(account.id, '重新连接', { closeBrowser: true })
    }

    const { AccountSession } = await this.loadAccountSessionModule()
    const accountSession = new AccountSession(platformName, account)
    this.accountSessions.set(account.id, accountSession)
    return accountSession
  }

  getSession(accountId: string): Result.Result<AccountSession, Error> {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return Result.fail(new AccountNotFoundError())
    }
    return Result.succeed(accountSession)
  }

  setAccountName(accountId: string, accountName: string) {
    this.accountNames.set(accountId, accountName)
  }

  getAccountName(accountId: string) {
    return this.accountNames.get(accountId) ?? '未定义账号'
  }

  getActiveTaskTypes(accountId: string): string[] {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return []
    }
    return accountSession.getActiveTaskTypes()
  }

  setAutoStartOnLiveEnabled(accountId: string, enabled: boolean): boolean {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return false
    }
    accountSession.setAutoStartOnLiveEnabled(enabled)
    return true
  }

  wakeIdleSession(accountId: string, reason: string): boolean {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      return false
    }
    accountSession.wakeFromIdleSleep(reason)
    return true
  }

  async closeSession(
    accountId: string,
    reason?: string,
    options?: { closeBrowser?: boolean },
  ): Promise<void> {
    const accountSession = this.accountSessions.get(accountId)
    if (!accountSession) {
      this.logger.info(`[closeSession] 账号 ${accountId} 不存在，无需关闭`)
      return
    }

    this.logger.info(
      `[closeSession] 正在关闭账号 ${accountId} 的会话，原因: ${reason || '未知'}，关闭浏览器: ${options?.closeBrowser ?? '默认'}`,
    )
    // 等待会话真正完成清理后再从管理器中移除，避免旧浏览器残留
    await accountSession.disconnect(reason, { closeBrowser: options?.closeBrowser ?? false })
    this.accountSessions.delete(accountId)
    this.logger.info(`[closeSession] 账号 ${accountId} 会话已关闭并从管理器中移除`)
  }

  async cleanup(): Promise<void> {
    if (this.cleanupPromise) {
      return this.cleanupPromise
    }

    this.cleanupPromise = (async () => {
      // 移除事件监听器，避免内存泄漏
      emitter.off('page-closed', this.pageClosedHandler)

      const sessions = Array.from(this.accountSessions.values())
      const disconnectResults = await Promise.allSettled(
        sessions.map(session => session.disconnect('应用退出', { closeBrowser: true })),
      )

      disconnectResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `[cleanup] 应用退出时关闭会话失败 (session ${index + 1})`,
            result.reason,
          )
        }
      })

      this.accountSessions.clear()
      this.accountNames.clear()
      const { browserManager } = await import('./BrowserSessionManager')
      await browserManager.cleanup().catch(error => {
        this.logger.error('[cleanup] 关闭共享浏览器失败', error)
      })
    })()

    return this.cleanupPromise
  }
}

export const accountManager = new AccountManager()
