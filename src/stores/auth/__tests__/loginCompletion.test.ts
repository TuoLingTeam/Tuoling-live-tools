import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getTrialStatus: vi.fn(),
  getUserStatus: vi.fn(),
  startTrial: vi.fn(),
  loadFromCloud: vi.fn(),
  setupAutoSync: vi.fn(),
  syncToCloud: vi.fn(),
}))

vi.mock('@/services/apiClient', () => ({
  getMe: mocks.getMe,
  getTrialStatus: mocks.getTrialStatus,
  getUserStatus: mocks.getUserStatus,
  startTrial: mocks.startTrial,
}))

vi.mock('@/services/configSyncService', () => ({
  configSyncService: {
    loadFromCloud: mocks.loadFromCloud,
    setupAutoSync: mocks.setupAutoSync,
    syncToCloud: mocks.syncToCloud,
  },
}))

const storage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => (storage.has(key) ? storage.get(key)! : null)),
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

let useAccounts: typeof import('@/hooks/useAccounts').useAccounts
let useAuthStore: typeof import('@/stores/authStore').useAuthStore
let initializeStorage: typeof import('@/utils/storage/init').initializeStorage

const safeUser = {
  id: 'user-1',
  username: '13800138000',
  email: '',
  phone: '13800138000',
  createdAt: '2026-05-18T00:00:00.000Z',
  lastLogin: null,
  status: 'active' as const,
  plan: 'trial' as const,
  expire_at: null,
  deviceId: '',
  machineFingerprint: '',
  balance: 0,
}

function seedAccountsStorage() {
  localStorage.setItem(
    'xiuer-accounts-user-1',
    JSON.stringify({
      data: {
        accounts: [{ id: 'acc-1', name: '账号A' }],
        currentAccountId: 'acc-1',
        defaultAccountId: null,
      },
      meta: {
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
        version: 1,
      },
    }),
  )
}

describe('completeLoginSession', () => {
  beforeAll(async () => {
    ;({ initializeStorage } = await import('@/utils/storage/init'))
    ;({ useAccounts } = await import('@/hooks/useAccounts'))
    ;({ useAuthStore } = await import('@/stores/authStore'))
    initializeStorage()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()

    mocks.loadFromCloud.mockResolvedValue({ success: true })
    mocks.getUserStatus.mockResolvedValue({
      user_id: 'user-1',
      username: '13800138000',
      status: 'active',
      plan: 'pro',
      max_accounts: 5,
    })

    useAccounts.setState({
      accounts: [],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
    })
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      token: null,
      refreshToken: null,
      isLoading: true,
      error: 'old error',
      authCheckDone: false,
      isOffline: true,
      userStatus: null,
    })
  })

  it('sets auth state, loads local user data, restores cloud config, and refreshes user status', async () => {
    seedAccountsStorage()

    await useAuthStore.getState().completeLoginSession(safeUser, {
      userIdFallback: '13800138000',
      source: 'sms-login',
    })

    const authState = useAuthStore.getState()
    expect(authState.isAuthenticated).toBe(true)
    expect(authState.user?.id).toBe('user-1')
    expect(authState.user?.plan).toBe('pro')
    expect(authState.userStatus?.plan).toBe('pro')
    expect(authState.token).toBeNull()
    expect(authState.refreshToken).toBeNull()
    expect(authState.isLoading).toBe(false)
    expect(authState.error).toBeNull()
    expect(authState.authCheckDone).toBe(true)
    expect(authState.isOffline).toBe(false)

    expect(useAccounts.getState().accounts).toEqual([{ id: 'acc-1', name: '账号A' }])
    expect(useAccounts.getState().currentAccountId).toBe('acc-1')
    expect(mocks.loadFromCloud).toHaveBeenCalledTimes(1)
    expect(mocks.getUserStatus).toHaveBeenCalledTimes(1)
  })
})
