import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ITask } from '#/tasks/ITask'

const setStreamStateMock = vi.fn()
const setDisconnectedMock = vi.fn()
const sendMock = vi.fn()

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

describe('stopAccountSessionTasksAndUpdateState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
