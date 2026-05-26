import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { StreamStatus } from 'shared/streamStatus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const windowSendMock = vi.fn()
const setStreamStateMock = vi.fn()
const setDisconnectedMock = vi.fn()
const releaseSessionBrowserMock = vi.fn()
const performCommentMock = vi.fn()

class FakePlatform {
  _isPerformComment = true
  platformName = 'Fake'
  connect = vi.fn()
  login = vi.fn()
  getAccountName = vi.fn()
  isLive = vi.fn()
  disconnect = vi.fn()
  performComment = performCommentMock
  getCommentPage = vi.fn(() => null)
}

class FakeStreamStateDetector {
  isRunning = false
  currentState: StreamStatus = 'unknown'
  stop = vi.fn()
  setState = vi.fn((state: StreamStatus) => {
    this.currentState = state
  })
  updateBrowserSession = vi.fn()
  keepAlive = vi.fn(() => true)
  setOnStreamEndedCallback = vi.fn()
  setOnStateChangedCallback = vi.fn()
  getCurrentState = vi.fn(() => this.currentState)
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

  afterEach(() => {
    vi.useRealTimers()
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

  it('still marks disconnected when releasing the browser session fails', async () => {
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

    await session.disconnect('用户主动断开', {
      closeBrowser: true,
    })

    expect(releaseSessionBrowserMock).toHaveBeenCalledWith(browserSession)
    expect((session as any).browserSession).toBe(null)
    expect((session as any).isDisconnected).toBe(true)
    expect((session as any).isDisconnecting).toBe(false)
    expect(setStreamStateMock).toHaveBeenCalledWith('acc-1', 'offline')
    expect(setDisconnectedMock).toHaveBeenCalledWith('acc-1')
    expect(windowSendMock).toHaveBeenCalledWith(IPC_CHANNELS.tasks.liveControl.stateChanged, {
      accountId: 'acc-1',
      connectState: {
        status: 'disconnected',
        phase: 'idle',
        error: '用户主动断开',
        session: null,
        lastVerifiedAt: null,
      },
    })
  })

  it('releases headless browser resources when a stream ends', async () => {
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
        close: vi.fn(),
      },
      browserOwnership: 'shared',
      isHeadless: true,
    }

    ;(session as any).browserSession = browserSession
    ;(session as any).streamStateDetector.isRunning = true

    await session.stopForStreamEnded('直播已结束')

    expect((session as any).streamStateDetector.stop).toHaveBeenCalled()
    expect(browserSession.page.close).toHaveBeenCalled()
    expect(browserSession.context.close).toHaveBeenCalled()
    expect(releaseSessionBrowserMock).toHaveBeenCalledWith(browserSession)
    expect((session as any).browserSession).toBe(null)
    expect((session as any).streamStateDetector.updateBrowserSession).toHaveBeenCalledWith(null)
    expect(setStreamStateMock).toHaveBeenCalledWith('acc-1', 'offline')
  })

  it('sleeps offline no-task headless sessions after the idle timeout', async () => {
    vi.useFakeTimers()
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
        close: vi.fn(),
      },
      browserOwnership: 'shared',
      isHeadless: true,
    }

    ;(session as any).browserSession = browserSession
    ;(session as any).streamStateDetector.currentState = 'offline'

    ;(session as any).handleStreamStateChanged('offline')
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect((session as any).streamStateDetector.stop).toHaveBeenCalled()
    expect(browserSession.page.close).toHaveBeenCalled()
    expect(browserSession.context.close).toHaveBeenCalled()
    expect(releaseSessionBrowserMock).toHaveBeenCalledWith(browserSession)
    expect((session as any).browserSession).toBe(null)
    expect((session as any).streamStateDetector.updateBrowserSession).toHaveBeenCalledWith(null)
  })

  it('does not sleep when auto-start-on-live is enabled', async () => {
    vi.useFakeTimers()
    const { AccountSession } = await import('#/services/AccountSession')

    const session = new AccountSession(
      'taobao' as any,
      { id: 'acc-1', name: '账号A' } as any,
      createLoggerStub(),
    )
    ;(session as any).browserSession = {
      page: { isClosed: vi.fn(() => false), close: vi.fn() },
      context: { close: vi.fn() },
      browser: { isConnected: vi.fn(() => true), close: vi.fn() },
      browserOwnership: 'shared',
      isHeadless: true,
    }
    ;(session as any).streamStateDetector.currentState = 'offline'

    session.setAutoStartOnLiveEnabled(true)
    ;(session as any).handleStreamStateChanged('offline')
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect((session as any).streamStateDetector.stop).not.toHaveBeenCalled()
    expect(releaseSessionBrowserMock).not.toHaveBeenCalled()
  })
})

describe('AccountSession sendComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    performCommentMock.mockResolvedValue(Result.succeed(true))
  })

  it('waits for platform comment sending and returns the real send result', async () => {
    const { AccountSession } = await import('#/services/AccountSession')
    const session = new AccountSession(
      'taobao' as any,
      { id: 'acc-1', name: '账号A' } as any,
      createLoggerStub(),
    )

    const result = await session.sendComment('@周姐 好用')

    expect(Result.isSuccess(result)).toBe(true)
    expect(performCommentMock).toHaveBeenCalledWith('@周姐 好用', false)
  })
})
