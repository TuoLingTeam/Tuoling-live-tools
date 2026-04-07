import type {
  AIChatMessage,
  AIProvider,
  AISharedStoreSnapshot,
  ProviderConfig,
} from 'shared/aiChat'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { providers } from 'shared/providers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { SecureStorage } from '@/utils/encryption'

export type {
  AIChatContextMessage,
  AIChatMessage as ChatMessage,
  AIProvider,
  ProviderConfig,
} from 'shared/aiChat'

const AI_CHAT_API_KEYS_STORAGE_KEY = 'ai_chat_api_keys'

type APIKeys = {
  [key in AIProvider]: string
}

function hasAnyApiKey(apiKeys: Partial<Record<AIProvider, string>>): boolean {
  return Object.values(apiKeys).some(value => typeof value === 'string' && value.trim().length > 0)
}

function createDefaultAPIKeys(): APIKeys {
  return Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider as AIProvider] = ''
      return acc
    },
    { custom: '' } as Record<AIProvider, string>,
  )
}

function loadLegacyStoredAPIKeys(): Partial<Record<AIProvider, string>> {
  if (typeof localStorage === 'undefined') {
    return {}
  }

  return (
    SecureStorage.getItem<Partial<Record<AIProvider, string>>>(AI_CHAT_API_KEYS_STORAGE_KEY) ?? {}
  )
}

function clearLegacyStoredAPIKeys() {
  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    SecureStorage.removeItem(AI_CHAT_API_KEYS_STORAGE_KEY)
  } catch (error) {
    console.warn('[useAIChat] Failed to clear legacy API key storage:', error)
  }
}

async function loadStoredAPIKeysFromMain(): Promise<Partial<Record<AIProvider, string>>> {
  if (typeof window === 'undefined' || !window.ipcRenderer) {
    return {}
  }

  return await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys)
}

async function persistAPIKeysToMain(apiKeys: APIKeys): Promise<void> {
  if (typeof window === 'undefined' || !window.ipcRenderer) {
    return
  }

  if (!hasAnyApiKey(apiKeys)) {
    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys)
    return
  }

  await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.setStoredApiKeys, apiKeys)
}

type Status = 'ready' | 'waiting' | 'replying'

export interface AIChatStore extends AISharedStoreSnapshot {
  status: Status
  isApiKeysHydrated: boolean
  hydrateApiKeys: () => Promise<void>
  saveApiKeys: (apiKeys: Partial<Record<AIProvider, string>>) => Promise<void>
  setCustomBaseURL: (url: string) => void
  setConfig: (config: Partial<ProviderConfig>) => void
  addMessage: (message: Omit<AIChatMessage, 'id' | 'timestamp'>) => void
  appendToChat: (chunk: string) => void
  appendToReasoning: (chunk: string) => void
  markLastAssistantAsError: (message: string) => void
  tryToHandleEmptyMessage: (message: string) => void
  setMessages: (messages: AIChatMessage[]) => void
  setStatus: (status: Status) => void
  clearMessages: () => void
  autoScroll: boolean
  setAutoScroll: (value: boolean) => void
}

export const useAIChatStore = create<AIChatStore>()(
  persist(
    immer((set, get) => {
      const modelPreferences = Object.keys(providers).reduce(
        (acc, provider) => {
          acc[provider as AIProvider] =
            providers[provider as keyof typeof providers].models[0] || ''
          return acc
        },
        {} as Record<AIProvider, string>,
      )

      const defaultApiKeys = createDefaultAPIKeys()

      return {
        messages: [],
        status: 'ready',
        apiKeys: defaultApiKeys,
        isApiKeysHydrated: false,
        config: {
          provider: 'deepseek',
          model: providers.deepseek.models[0],
          modelPreferences,
        },
        hydrateApiKeys: async () => {
          if (get().isApiKeysHydrated) {
            return
          }

          const storedApiKeys = loadLegacyStoredAPIKeys()

          try {
            const mainApiKeys = await loadStoredAPIKeysFromMain()
            if (hasAnyApiKey(mainApiKeys)) {
              set(state => {
                state.apiKeys = { ...defaultApiKeys, ...mainApiKeys }
                state.isApiKeysHydrated = true
              })
              clearLegacyStoredAPIKeys()
              return
            }

            if (hasAnyApiKey(storedApiKeys)) {
              const migratedApiKeys = { ...defaultApiKeys, ...storedApiKeys }
              await persistAPIKeysToMain(migratedApiKeys)
              set(state => {
                state.apiKeys = migratedApiKeys
                state.isApiKeysHydrated = true
              })
              clearLegacyStoredAPIKeys()
              return
            }
          } catch (error) {
            console.error('[useAIChat] Failed to hydrate API keys from main process:', error)
            if (hasAnyApiKey(storedApiKeys)) {
              set(state => {
                state.apiKeys = { ...defaultApiKeys, ...storedApiKeys }
              })
            }
          }

          set(state => {
            state.isApiKeysHydrated = true
          })
        },
        saveApiKeys: async apiKeys => {
          const nextApiKeys = { ...defaultApiKeys, ...apiKeys }
          set(state => {
            state.apiKeys = nextApiKeys
          })
          await persistAPIKeysToMain(nextApiKeys)
          clearLegacyStoredAPIKeys()
        },
        customBaseURL: '',
        setCustomBaseURL: url => {
          set(state => {
            state.customBaseURL = url
          })
        },
        setConfig: config => {
          set(state => {
            if (config.provider) {
              const newModel = config.model || state.config.modelPreferences[config.provider]
              state.config.provider = config.provider
              state.config.model = newModel
              state.config.modelPreferences[config.provider] = newModel
            } else if (config.model) {
              state.config.model = config.model
              state.config.modelPreferences[state.config.provider] = config.model
            }
          })
        },
        addMessage: message => {
          set(state => {
            state.messages.push({
              ...message,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
            })
          })
        },
        appendToChat: chunk => {
          set(state => {
            if (state.messages[state.messages.length - 1].role !== 'assistant') {
              state.messages.push({
                role: 'assistant',
                content: chunk,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
              })
            } else {
              state.messages[state.messages.length - 1].content += chunk
            }
          })
        },
        appendToReasoning: chunk => {
          set(state => {
            if (state.messages[state.messages.length - 1].role !== 'assistant') {
              state.messages.push({
                role: 'assistant',
                reasoning_content: chunk,
                content: '',
                id: crypto.randomUUID(),
                timestamp: Date.now(),
              })
            } else {
              state.messages[state.messages.length - 1].reasoning_content += chunk
            }
          })
        },
        markLastAssistantAsError: message => {
          set(state => {
            const lastMessage = state.messages[state.messages.length - 1]

            if (lastMessage?.role === 'assistant') {
              lastMessage.content = lastMessage.content
                ? `${lastMessage.content}\n\n${message}`
                : message
              lastMessage.isError = true
              return
            }

            state.messages.push({
              role: 'assistant',
              content: message,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              isError: true,
            })
          })
        },
        tryToHandleEmptyMessage: message => {
          set(state => {
            const lastRole = state.messages[state.messages.length - 1]?.role
            if (!lastRole || lastRole === 'user') {
              state.messages.push({
                role: 'assistant',
                content: message,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                isError: true,
              })
            }
          })
        },
        setMessages: messages => {
          set(state => {
            state.messages = messages
          })
        },
        setStatus: status => {
          set(state => {
            state.status = status
          })
        },
        clearMessages: () => {
          set(state => {
            state.messages = []
          })
        },
        autoScroll: true,
        setAutoScroll: value => set({ autoScroll: value }),
      }
    }),
    {
      name: 'ai-chat-storage',
      partialize: state => ({
        config: state.config,
        customBaseURL: state.customBaseURL,
      }),
    },
  ),
)
