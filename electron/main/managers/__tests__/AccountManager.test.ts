import { beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectMock = vi.fn<() => Promise<void>>()
const cleanupBrowserManagerMock = vi.fn<() => Promise<void>>()

class FakeAccountSession {
  disconnect = disconnectMock

  constructor(
    readonly platformName: string,
    readonly account: { id: string; name: string },
  ) {}
}

vi.mock('#/services/AccountSession', () => ({
  AccountSession: FakeAccountSession,
}))

vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: {
    cleanup: cleanupBrowserManagerMock,
  },
}))

vi.mock('#/logger', () => {
  const createMockLogger = () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      debug: vi.fn(),
      scope: vi.fn(),
    }
    logger.scope.mockReturnValue(logger)
    return logger
  }

  return {
    createLogger: vi.fn(() => createMockLogger()),
  }
})

describe('AccountManager session cleanup', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    disconnectMock.mockResolvedValue(undefined)
    cleanupBrowserManagerMock.mockResolvedValue(undefined)

    const { emitter } = await import('#/event/eventBus')
    emitter.removeAllListeners('page-closed')
  })

  it('closes the previous session before reconnecting the same account', async () => {
    const { AccountManager } = await import('#/managers/AccountManager')

    const manager = new AccountManager()
    const account = { id: 'acc-1', name: '账号A' } as any

    const firstSession = await manager.createSession('douyin' as any, account)
    const secondSession = await manager.createSession('douyin' as any, account)

    expect(firstSession).not.toBe(secondSession)
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(disconnectMock).toHaveBeenCalledWith('重新连接', { closeBrowser: true })
    expect(manager.accountSessions.get(account.id)).toBe(secondSession)
  })

  it('waits for disconnect completion before removing the session from the manager', async () => {
    const { AccountManager } = await import('#/managers/AccountManager')

    let resolveDisconnect: (() => void) | null = null
    disconnectMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveDisconnect = resolve
        }),
    )

    const manager = new AccountManager()
    const account = { id: 'acc-1', name: '账号A' } as any

    await manager.createSession('douyin' as any, account)

    const closePromise = manager.closeSession(account.id, '用户主动断开', { closeBrowser: true })

    expect(manager.accountSessions.has(account.id)).toBe(true)

    resolveDisconnect?.()
    await closePromise

    expect(disconnectMock).toHaveBeenCalledWith('用户主动断开', { closeBrowser: true })
    expect(manager.accountSessions.has(account.id)).toBe(false)
  })

  it('keeps the session registered when disconnect cleanup fails', async () => {
    const { AccountManager } = await import('#/managers/AccountManager')

    disconnectMock.mockRejectedValueOnce(new Error('close failed'))

    const manager = new AccountManager()
    const account = { id: 'acc-1', name: '账号A' } as any

    await manager.createSession('douyin' as any, account)

    await expect(
      manager.closeSession(account.id, '用户主动断开', { closeBrowser: true }),
    ).rejects.toThrow('close failed')

    expect(manager.accountSessions.has(account.id)).toBe(true)
  })

  it('waits for all session disconnects before clearing manager state during cleanup', async () => {
    const { AccountManager } = await import('#/managers/AccountManager')

    let resolveDisconnect: (() => void) | null = null
    disconnectMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveDisconnect = resolve
        }),
    )

    const manager = new AccountManager()
    const account = { id: 'acc-1', name: '账号A' } as any

    await manager.createSession('douyin' as any, account)

    const cleanupPromise = manager.cleanup()

    expect(manager.accountSessions.has(account.id)).toBe(true)

    resolveDisconnect?.()
    await cleanupPromise

    expect(disconnectMock).toHaveBeenCalledWith('应用退出', { closeBrowser: true })
    expect(manager.accountSessions.has(account.id)).toBe(false)
    expect(manager.accountNames.size).toBe(0)
  })
})
