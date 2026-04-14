import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

export const aiChatAPI = {
  chat: async (payload: {
    messages: Array<{ role: string; content: string }>
    apiKey: string
    provider: string
    model: string
    customBaseURL?: string
    temperature?: number
  }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.chat, payload)
  },

  normalChat: async (payload: {
    messages: Array<{ role: string; content: string }>
    apiKey: string
    provider: string
    model: string
    customBaseURL?: string
    temperature?: number
  }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.normalChat, payload)
  },

  testApiKey: async (payload: { apiKey: string; provider: string; customBaseURL?: string }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.testApiKey, payload)
  },

  getStoredApiKeys: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys)
  },

  setStoredApiKeys: async (apiKeys: Record<string, string>) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.setStoredApiKeys, apiKeys)
  },

  clearStoredApiKeys: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys)
  },

  onStream: (callback: (payload: { chunk?: string; type?: string; done?: boolean }) => void) => {
    const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.tasks.aiChat.stream, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.tasks.aiChat.stream, listener)
  },

  onError: (callback: (payload: { error: string }) => void) => {
    const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.tasks.aiChat.error, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.tasks.aiChat.error, listener)
  },
}

contextBridge.exposeInMainWorld('aiChatAPI', aiChatAPI)
