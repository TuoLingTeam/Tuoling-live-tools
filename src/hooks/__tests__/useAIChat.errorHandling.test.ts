import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
})

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageMock,
    aiChatAPI: {
      getStoredApiKeys: vi.fn(),
      setStoredApiKeys: vi.fn(),
      clearStoredApiKeys: vi.fn(),
    },
  },
  configurable: true,
})

type AIChatStore = typeof import('@/hooks/useAIChat').useAIChatStore
type StoreState = ReturnType<AIChatStore['getState']>

let useAIChatStore: AIChatStore
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
  initialState = useAIChatStore.getState()
})

describe('useAIChatStore error handling', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
    resetStoreState()
  })

  it('marks the current assistant reply as failed instead of appending a second assistant message', () => {
    const store = useAIChatStore.getState()

    store.addMessage({ role: 'user', content: 'hello' })
    store.appendToChat('Partial answer')
    store.markLastAssistantAsError('402 Insufficient Balance')

    const messages = useAIChatStore.getState().messages

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'Partial answer\n\n402 Insufficient Balance',
    })
  })

  it('creates a new assistant error message when no assistant reply exists yet', () => {
    const store = useAIChatStore.getState()

    store.addMessage({ role: 'user', content: 'hello' })
    store.markLastAssistantAsError('network timeout')

    const messages = useAIChatStore.getState().messages

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'network timeout',
    })
  })
})
