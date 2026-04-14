import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
const LEGACY_STORAGE_KEY = 'secure_ai_chat_api_keys'

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

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

const ipcInvoke = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
    aiChatAPI: {
      getStoredApiKeys: () => ipcInvoke(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys),
      setStoredApiKeys: (payload: unknown) =>
        ipcInvoke(IPC_CHANNELS.tasks.aiChat.setStoredApiKeys, payload),
      clearStoredApiKeys: () => ipcInvoke(IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys),
    },
  },
  configurable: true,
})

type AIChatStore = typeof import('@/hooks/useAIChat').useAIChatStore
type StoreState = ReturnType<AIChatStore['getState']>
type APIKeys = Partial<StoreState['apiKeys']>
type IPCChannels = typeof import('shared/ipcChannels').IPC_CHANNELS

let useAIChatStore: AIChatStore
let IPC_CHANNELS: IPCChannels
let initialState: StoreState

function resetStoreState() {
  useAIChatStore.setState({
    messages: [],
    status: 'ready',
    apiKeys: { ...initialState.apiKeys },
    isApiKeysHydrated: false,
    config: {
      ...initialState.config,
      modelPreferences: { ...initialState.config.modelPreferences },
    },
    customBaseURL: '',
    systemPrompt: undefined,
    autoScroll: true,
  })
}

beforeAll(async () => {
  ;({ useAIChatStore } = await import('@/hooks/useAIChat'))
  ;({ IPC_CHANNELS } = await import('shared/ipcChannels'))
  initialState = useAIChatStore.getState()
})

describe('useAIChatStore API key hydration', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
    resetStoreState()
  })

  it('prefers API keys already stored in the main process', async () => {
    const mainApiKeys: APIKeys = { deepseek: 'main-deepseek-key' }

    ipcInvoke.mockImplementation(async channel => {
      if (channel === IPC_CHANNELS.tasks.aiChat.getStoredApiKeys) {
        return mainApiKeys
      }

      throw new Error(`Unexpected channel: ${channel}`)
    })

    storage.set(LEGACY_STORAGE_KEY, 'legacy-ciphertext')

    await useAIChatStore.getState().hydrateApiKeys()

    expect(useAIChatStore.getState().apiKeys.deepseek).toBe('main-deepseek-key')
    expect(useAIChatStore.getState().isApiKeysHydrated).toBe(true)
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys)
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY)
    expect(storage.has(LEGACY_STORAGE_KEY)).toBe(false)
  })

  it('drops legacy renderer storage instead of migrating it when main storage is empty', async () => {
    ipcInvoke.mockImplementation(async channel => {
      if (channel === IPC_CHANNELS.tasks.aiChat.getStoredApiKeys) {
        return {}
      }

      throw new Error(`Unexpected channel: ${channel}`)
    })

    storage.set(LEGACY_STORAGE_KEY, 'legacy-ciphertext')

    await useAIChatStore.getState().hydrateApiKeys()

    expect(useAIChatStore.getState().apiKeys.deepseek).toBe('')
    expect(useAIChatStore.getState().apiKeys.custom).toBe('')
    expect(useAIChatStore.getState().isApiKeysHydrated).toBe(true)
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys)
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY)
    expect(storage.has(LEGACY_STORAGE_KEY)).toBe(false)
  })

  it('clears legacy renderer storage after saving API keys to the main process', async () => {
    ipcInvoke.mockResolvedValue({ success: true })
    storage.set(LEGACY_STORAGE_KEY, 'legacy-ciphertext')

    await useAIChatStore.getState().saveApiKeys({ deepseek: 'saved-in-main' })

    expect(useAIChatStore.getState().apiKeys.deepseek).toBe('saved-in-main')
    expect(ipcInvoke).toHaveBeenCalledWith(
      IPC_CHANNELS.tasks.aiChat.setStoredApiKeys,
      expect.objectContaining({ deepseek: 'saved-in-main' }),
    )
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY)
    expect(storage.has(LEGACY_STORAGE_KEY)).toBe(false)
  })

  it('keeps legacy renderer storage untouched when main-process hydration fails', async () => {
    ipcInvoke.mockRejectedValue(new Error('ipc unavailable'))
    storage.set(LEGACY_STORAGE_KEY, 'legacy-ciphertext')

    await useAIChatStore.getState().hydrateApiKeys()

    expect(useAIChatStore.getState().apiKeys.deepseek).toBe('')
    expect(useAIChatStore.getState().isApiKeysHydrated).toBe(true)
    expect(localStorageMock.removeItem).not.toHaveBeenCalledWith(LEGACY_STORAGE_KEY)
    expect(storage.get(LEGACY_STORAGE_KEY)).toBe('legacy-ciphertext')
  })
})
