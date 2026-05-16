import { IPC_CHANNELS } from 'shared/ipcChannels'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowSendMock = vi.fn()
const setStreamStateMock = vi.fn()
const setDisconnectedMock = vi.fn()
const releaseSessionBrowserMock = vi.fn()

class FakePlatform {
  platformName = 'Fake'
  connect = vi.fn()
  login = vi.fn()
  getAccountName = vi.fn()
  isLive = vi.fn()
  disconnect = vi.fn()
}

class FakeStreamStateDetector {
  isRunning = false
  stop = vi.fn()
  setState = vi.fn()
  updateBrowserSession = vi.fn()
  keepAlive = vi.fn(() => true)
  setOnStreamEndedCallback = vi.fn()
}

vi.mock('#/platforms', () => ({
  platformFactory: {
    taobao: FakePlatform,
  },
}))

vi.mock('#/services/StreamStateDetector', () => ({
  StreamStateDetector: FakeStreamStateDetector,
}))

vi.mock('#/windowManager', () => ({
  default: {
    send: windowSendMock,
  },
}))

vi.mock('#/services/AccountScopedRuntimeManager', () => ({
  accountRuntimeManager: {
    setStreamState: setStreamStateMock,
    setDisconnected: setDisconnectedMock,
  },
}))

vi.mock('#/logger', () => ({
  createLogger: vi.fn(() => createLoggerStub()),
}))

vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: {
    releaseSessionBrowser: releaseSessionBrowserMock,
  },
}))

vi.mock('#/tasks/AutoCommentTask', () => ({
  createAutoCommentTask: vi.fn(),
}))

vi.mock('#/tasks/AutoPopupTask', () => ({
  createAutoPopupTask: vi.fn(),
}))

vi.mock('#/tasks/CommentListenerTask', () => ({
  createCommentListenerTask: vi.fn(),
}))

vi.mock('#/tasks/PinCommentTask', () => ({
  createPinCommentTask: vi.fn(),
}))

vi.mock('#/tasks/SendBatchMessageTask', () => ({
  createSendBatchMessageTask: vi.fn(),
}))

vi.mock('#/tasks/SubAccountInteractionTask', () => ({
  createSubAccountInteractionTask: vi.fn(),
}))

function createLoggerStub() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    scope: vi.fn(),
  }
  logger.scope.mockReturnValue(logger)
  return logger as any
}

describe('AccountSession disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    releaseSessionBrowserMock.mockResolvedValue(undefined)
  })

  it('marks browser-close-style disconnects as disconnected instead of error', async () => {
    const { AccountSession } = await import('#/services/AccountSession')

    const session = new AccountSession(
      'taobao' as any,
      { id: 'acc-1', name: '账号A' } as any,
      createLoggerStub(),
    )

    await session.disconnect('browser_closed', {
      closeBrowser: false,
    })

    expect(windowSendMock).toHaveBeenCalledWith(IPC_CHANNELS.tasks.liveControl.stateChanged, {
      accountId: 'acc-1',
      connectState: {
        status: 'disconnected',
        phase: 'idle',
        error: 'browser_closed',
        session: null,
        lastVerifiedAt: null,
      },
    })
    expect(windowSendMock).toHaveBeenCalledWith(
      IPC_CHANNELS.tasks.liveControl.disconnectedEvent,
      'acc-1',
      'browser_closed',
    )
  })

  it('rejects when releasing the browser session fails and keeps the session retryable', async () => {
    const { AccountSession } = await import('#/services/AccountSession')

    const session = new AccountSession(
      'taobao' as any,
      { id: 'acc-1', name: '账号A' } as any,
      createLoggerStub(),
    )

    const browserSession = {
      page: {
        isClosed: vi.fn(() => false),
        close: vi.fn().mockResolvedValue(undefined),
      },
      context: {
        close: vi.fn().mockResolvedValue(undefined),
      },
      browser: {
        isConnected: vi.fn(() => true),
        close: vi.fn().mockResolvedValue(undefined),
      },
      browserOwnership: 'exclusive',
    }

    releaseSessionBrowserMock.mockRejectedValueOnce(new Error('浏览器关闭失败'))

    ;(session as any).browserSession = browserSession

    await expect(
      session.disconnect('用户主动断开', {
        closeBrowser: true,
      }),
    ).rejects.toThrow('浏览器关闭失败')

    expect(releaseSessionBrowserMock).toHaveBeenCalledWith(browserSession)
    expect((session as any).browserSession).toBe(browserSession)
    expect((session as any).isDisconnected).toBe(false)
    expect((session as any).isDisconnecting).toBe(false)
    expect(setStreamStateMock).not.toHaveBeenCalled()
    expect(setDisconnectedMock).not.toHaveBeenCalled()
    expect(windowSendMock).not.toHaveBeenCalled()
  })
})
