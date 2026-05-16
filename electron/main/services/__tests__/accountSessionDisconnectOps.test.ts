import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ITask } from '#/tasks/ITask'

const setStreamStateMock = vi.fn()
const setDisconnectedMock = vi.fn()
const sendMock = vi.fn()
const releaseSessionBrowserMock = vi.fn()

vi.mock('#/services/AccountScopedRuntimeManager', () => ({
  accountRuntimeManager: {
    setStreamState: setStreamStateMock,
    setDisconnected: setDisconnectedMock,
  },
}))

vi.mock('#/windowManager', () => ({
  default: {
    send: sendMock,
  },
}))

vi.mock('#/managers/BrowserSessionManager', () => ({
  browserManager: {
    releaseSessionBrowser: releaseSessionBrowserMock,
  },
}))

describe('stopAccountSessionTasksAndUpdateState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    releaseSessionBrowserMock.mockResolvedValue(undefined)
  })

  it('releases shared browser sessions without treating the connected browser as a close failure', async () => {
    const { stopAccountSessionTasksAndUpdateState } = await import(
      '#/services/accountSessionDisconnectOps'
    )

    const setBrowserSession = vi.fn()
    const updateBrowserSession = vi.fn()
    const emitConnectionState = vi.fn()
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
    }

    await stopAccountSessionTasksAndUpdateState({
      accountId: 'acc-1',
      reason: '用户主动断开',
      closeBrowser: true,
      sendDisconnectEvent: true,
      activeTasks: new Map(),
      streamStateDetector: {
        stop: vi.fn(),
        setState: vi.fn(),
        updateBrowserSession,
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      emitConnectionState,
      withTimeout: promise => promise,
      getBrowserSession: () => browserSession as any,
      setBrowserSession,
    })

    expect(releaseSessionBrowserMock).toHaveBeenCalledWith(browserSession)
    expect(setBrowserSession).toHaveBeenCalledWith(null)
    expect(updateBrowserSession).toHaveBeenCalledWith(null)
    expect(emitConnectionState).toHaveBeenCalledWith({
      status: 'disconnected',
      phase: 'idle',
      error: '用户主动断开',
      session: null,
      lastVerifiedAt: null,
    })
  })

  it('waits for async task.stop before clearing active tasks and emitting disconnect state', async () => {
    const { stopAccountSessionTasksAndUpdateState } = await import(
      '#/services/accountSessionDisconnectOps'
    )

    let resolveStop: (() => void) | null = null
    const task: ITask = {
      getTaskId: () => 'task-1',
      start: async () => {},
      stop: vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolveStop = resolve
          }),
      ),
      addStopListener: () => {},
      getLastStopInfo: () => ({ reason: null }),
      isRunning: () => true,
    }

    const activeTasks = new Map<LiveControlTask['type'], ITask>([['commentListener', task]])

    const promise = stopAccountSessionTasksAndUpdateState({
      accountId: 'acc-1',
      reason: '应用退出',
      closeBrowser: false,
      sendDisconnectEvent: true,
      activeTasks,
      streamStateDetector: {
        stop: vi.fn(),
        setState: vi.fn(),
        updateBrowserSession: vi.fn(),
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      emitConnectionState: vi.fn(),
      withTimeout: promise => promise,
      getBrowserSession: () => null,
      setBrowserSession: () => {},
    })

    await Promise.resolve()

    expect(activeTasks.size).toBe(1)
    expect(sendMock).not.toHaveBeenCalled()
    expect(setDisconnectedMock).not.toHaveBeenCalled()

    resolveStop?.()
    await promise

    expect(activeTasks.size).toBe(0)
    expect(setStreamStateMock).toHaveBeenCalledWith('acc-1', 'offline')
    expect(setDisconnectedMock).toHaveBeenCalledWith('acc-1')
    expect(sendMock).toHaveBeenCalled()
  })
})
