import { IPC_CHANNELS } from 'shared/ipcChannels'
import { AIChatService } from '#/services/AIChatServices'
import {
  clearStoredAIApiKeys,
  getStoredAIApiKeys,
  setStoredAIApiKeys,
} from '#/services/AISecretsStorage'
import { typedIpcMainHandle } from '#/utils/ipc'
import windowManager from '#/windowManager'

function setupIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.chat,
    async (_, { messages, apiKey, provider, model, customBaseURL, temperature }) => {
      try {
        const aiService = await AIChatService.createService(apiKey, provider, customBaseURL)
        for await (const { content, reasoning } of aiService.chatStream(
          messages,
          model,
          temperature,
        )) {
          if (content) {
            windowManager.send(IPC_CHANNELS.tasks.aiChat.stream, {
              chunk: content,
              type: 'content',
            })
          }
          if (reasoning) {
            windowManager.send(IPC_CHANNELS.tasks.aiChat.stream, {
              chunk: reasoning,
              type: 'reasoning',
            })
          }
        }
        windowManager.send(IPC_CHANNELS.tasks.aiChat.stream, {
          done: true,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        windowManager.send(IPC_CHANNELS.tasks.aiChat.error, {
          error: errorMessage,
        })
      }
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.normalChat,
    async (_, { messages, apiKey, provider, model, customBaseURL, temperature }) => {
      try {
        const aiService = await AIChatService.createService(apiKey, provider, customBaseURL)
        const output = await aiService.chat(messages, model, temperature)
        return output
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        windowManager.send(IPC_CHANNELS.tasks.aiChat.error, {
          error: errorMessage,
        })
      }
      return null
    },
  )

  typedIpcMainHandle(
    IPC_CHANNELS.tasks.aiChat.testApiKey,
    async (_, { apiKey, provider, customBaseURL }) => {
      try {
        const aiService = await AIChatService.createService(apiKey, provider, customBaseURL)
        await aiService.checkAPIKey()
        return {
          success: true,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          success: false,
          error: errorMessage,
        }
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys, () => {
    return getStoredAIApiKeys()
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.aiChat.setStoredApiKeys, async (_, apiKeys) => {
    setStoredAIApiKeys(apiKeys)
    return { success: true }
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys, async () => {
    clearStoredAIApiKeys()
    return { success: true }
  })
}

export function setupAIChatIpcHandlers() {
  setupIpcHandlers()
}
