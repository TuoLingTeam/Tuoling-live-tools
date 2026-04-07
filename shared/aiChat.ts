import type { providers } from 'shared/providers'

export type AIProvider = keyof typeof providers

export interface AIChatContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning_content?: string
  isError?: boolean
}

export interface AIChatMessage extends AIChatContextMessage {
  id: string
  timestamp: number
}

export interface ProviderConfig {
  provider: AIProvider
  model: string
  modelPreferences: Record<AIProvider, string>
  temperature?: number
}

export interface AISharedStoreSnapshot {
  messages: AIChatMessage[]
  apiKeys: Record<AIProvider, string>
  config: ProviderConfig
  customBaseURL: string
  systemPrompt?: string
}
