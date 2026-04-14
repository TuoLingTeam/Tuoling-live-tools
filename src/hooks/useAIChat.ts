import type {
  AIChatMessage,
  AIProvider,
  AISharedStoreSnapshot,
  ProviderConfig,
} from 'shared/aiChat'
import { providers } from 'shared/providers'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export type {
  AIChatContextMessage,
  AIChatMessage as ChatMessage,
  AIProvider,
  ProviderConfig,
} from 'shared/aiChat'

const AI_CHAT_API_KEYS_STORAGE_KEY = 'ai_chat_api_keys'
const LEGACY_RENDERER_API_KEYS_STORAGE_KEY = `secure_${AI_CHAT_API_KEYS_STORAGE_KEY}`

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

function clearLegacyStoredAPIKeys() {
  if (typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.removeItem(LEGACY_RENDERER_API_KEYS_STORAGE_KEY)
  } catch (error) {
    console.warn('[useAIChat] Failed to clear legacy API key storage:', error)
  }
}

function hasLegacyStoredAPIKeys(): boolean {
  if (typeof localStorage === 'undefined') {
    return false
  }

  try {
    return localStorage.getItem(LEGACY_RENDERER_API_KEYS_STORAGE_KEY) !== null
  } catch (error) {
    console.warn('[useAIChat] Failed to inspect legacy API key storage:', error)
    return false
  }
}

async function loadStoredAPIKeysFromMain(): Promise<Partial<Record<AIProvider, string>>> {
  if (typeof window === 'undefined' || !window.aiChatAPI) {
    return {}
  }

  return (await window.aiChatAPI.getStoredApiKeys()) as Partial<Record<AIProvider, string>>
}

async function persistAPIKeysToMain(apiKeys: APIKeys): Promise<void> {
  if (typeof window === 'undefined' || !window.aiChatAPI) {
    return
  }

  if (!hasAnyApiKey(apiKeys)) {
    await window.aiChatAPI.clearStoredApiKeys()
    return
  }

  await window.aiChatAPI.setStoredApiKeys(apiKeys)
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

          const hasLegacyRendererSecrets = hasLegacyStoredAPIKeys()

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

            if (hasLegacyRendererSecrets) {
              console.warn(
                '[useAIChat] Ignoring legacy renderer-stored API keys; re-enter keys to migrate them into main-process storage',
              )
              clearLegacyStoredAPIKeys()
            }
          } catch (error) {
            console.error('[useAIChat] Failed to hydrate API keys from main process:', error)
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
