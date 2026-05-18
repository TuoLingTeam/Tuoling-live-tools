import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    storage.delete(key)
  }),
  clear: vi.fn(() => {
    storage.clear()
  }),
  key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
  get length() {
    return storage.size
  },
}

Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  configurable: true,
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
})

describe('taskRecoveryManifest', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.clear()

    const { LocalStorageAdapter, storageManager } = await import('@/utils/storage')
    storageManager.registerAdapter(new LocalStorageAdapter())
    storageManager.clear()
    storageManager.setCurrentUser(null)

    const { useAccounts } = await import('@/hooks/useAccounts')
    const { useLiveControlStore } = await import('@/hooks/useLiveControl')

    useAccounts.setState({
      accounts: [{ id: 'acc-1', name: '账号1' }],
      currentAccountId: 'acc-1',
      defaultAccountId: null,
      currentUserId: 'user-1',
    })

    useLiveControlStore.setState({
      contexts: {
        'acc-1': {
          connectState: {
            platform: 'buyin',
            status: 'connected',
            phase: 'streaming',
            session: null,
            lastVerifiedAt: Date.now(),
            error: null,
          },
          accountName: '账号1',
          streamState: 'live',
          liveSessionId: null,
          liveSessionStartedAt: null,
          liveSessionEndedAt: null,
        },
      },
      currentUserId: 'user-1',
    })
  })

  it('clears recovery intent after a manual stop', async () => {
    const {
      beginTaskRecoverySession,
      getRecoverableTaskAccounts,
      markTaskRecoveryStarted,
      markTaskRecoveryStopped,
    } = await import('@/utils/taskRecoveryManifest')

    beginTaskRecoverySession('user-1')
    markTaskRecoveryStarted('acc-1', 'autoSpeak')

    expect(getRecoverableTaskAccounts('user-1')).toEqual([
      expect.objectContaining({
        accountId: 'acc-1',
        platform: 'buyin',
        tasks: ['autoSpeak'],
      }),
    ])

    markTaskRecoveryStopped('acc-1', 'autoSpeak', 'manual')

    expect(getRecoverableTaskAccounts('user-1')).toEqual([])
  })

  it('preserves recovery intent after a disconnected stop', async () => {
    const {
      beginTaskRecoverySession,
      getRecoverableTaskAccounts,
      loadTaskRecoveryManifest,
      markTaskRecoveryStarted,
      markTaskRecoveryStopped,
    } = await import('@/utils/taskRecoveryManifest')

    beginTaskRecoverySession('user-1')
    markTaskRecoveryStarted('acc-1', 'autoPopup')
    markTaskRecoveryStopped('acc-1', 'autoPopup', 'disconnected')

    expect(getRecoverableTaskAccounts('user-1')[0]).toMatchObject({
      accountId: 'acc-1',
      tasks: ['autoPopup'],
    })
    expect(
      loadTaskRecoveryManifest('user-1')?.accounts['acc-1']?.tasks.autoPopup?.lastStopReason,
    ).toBe('disconnected')
  })

  it('only treats an unclean previous session as startup-recoverable', async () => {
    const {
      beginTaskRecoverySession,
      markTaskRecoverySessionClean,
      shouldRecoverPreviousTaskSession,
    } = await import('@/utils/taskRecoveryManifest')

    beginTaskRecoverySession('user-1')
    beginTaskRecoverySession('user-1')
    expect(shouldRecoverPreviousTaskSession('user-1')).toBe(true)

    markTaskRecoverySessionClean('user-1')
    beginTaskRecoverySession('user-1')
    expect(shouldRecoverPreviousTaskSession('user-1')).toBe(false)
  })
})
