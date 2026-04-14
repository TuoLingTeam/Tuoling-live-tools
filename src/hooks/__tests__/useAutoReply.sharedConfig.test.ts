import { providers } from 'shared/providers'
import { beforeEach, describe, expect, it } from 'vitest'
import { type AIProvider, useAIChatStore } from '../useAIChat'
import { useAITrialStore } from '../useAITrial'
import { getAISharedConfig } from '../useAutoReply'

function createApiKeys(overrides: Partial<Record<AIProvider, string>> = {}) {
  return Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider as AIProvider] = overrides[provider as AIProvider] ?? ''
      return acc
    },
    {} as Record<AIProvider, string>,
  )
}

function createModelPreferences() {
  return Object.keys(providers).reduce(
    (acc, provider) => {
      acc[provider as AIProvider] =
        provider === 'custom' ? '' : providers[provider as keyof typeof providers].models[0] || ''
      return acc
    },
    {} as Record<AIProvider, string>,
  )
}

describe('getAISharedConfig', () => {
  beforeEach(() => {
    useAIChatStore.setState({
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: '上一轮问题',
          timestamp: Date.now() - 1_000,
        },
        {
          id: 'm-2',
          role: 'assistant',
          content: '上一轮回答',
          timestamp: Date.now(),
        },
      ],
      apiKeys: createApiKeys(),
      config: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        modelPreferences: createModelPreferences(),
        temperature: 0.35,
      },
      customBaseURL: '',
      systemPrompt: 'system prompt',
      isApiKeysHydrated: true,
    })

    useAITrialStore.setState({
      enabled: false,
      loading: false,
      session: null,
    })
  })

  it('falls back to trial credentials for shared auto reply config when no user key exists', () => {
    useAITrialStore.setState({
      enabled: true,
      session: {
        token: 'trial-token',
        expiresAt: Date.now() + 10 * 60 * 1000,
        provider: 'deepseek',
        baseURL: 'https://trial.example.com',
        apiKey: 'trial-api-key',
        models: {
          chat: 'trial-chat-model',
          auto_reply: 'trial-auto-reply-model',
          knowledge_draft: 'trial-knowledge-model',
        },
        autoSendDefault: true,
      },
    })

    const sharedConfig = getAISharedConfig('auto_reply')

    expect(sharedConfig.provider).toBe('deepseek')
    expect(sharedConfig.model).toBe('trial-auto-reply-model')
    expect(sharedConfig.apiKey).toBe('trial-api-key')
    expect(sharedConfig.baseURL).toBe('https://trial.example.com')
    expect(sharedConfig.temperature).toBe(0.35)
    expect(sharedConfig.recentMessages).toEqual([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
    ])
  })

  it('prefers the saved user key over trial credentials', () => {
    useAIChatStore.setState({
      apiKeys: createApiKeys({ deepseek: 'user-api-key' }),
      customBaseURL: 'https://user.example.com',
    })

    useAITrialStore.setState({
      enabled: true,
      session: {
        token: 'trial-token',
        expiresAt: Date.now() + 10 * 60 * 1000,
        provider: 'deepseek',
        baseURL: 'https://trial.example.com',
        apiKey: 'trial-api-key',
        models: {
          chat: 'trial-chat-model',
          auto_reply: 'trial-auto-reply-model',
          knowledge_draft: 'trial-knowledge-model',
        },
        autoSendDefault: true,
      },
    })

    const sharedConfig = getAISharedConfig('auto_reply')

    expect(sharedConfig.provider).toBe('deepseek')
    expect(sharedConfig.model).toBe('deepseek-chat')
    expect(sharedConfig.apiKey).toBe('user-api-key')
    expect(sharedConfig.baseURL).toBe('https://user.example.com')
    expect(sharedConfig.temperature).toBe(0.35)
  })
})
