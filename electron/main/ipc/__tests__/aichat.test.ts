import { IPC_CHANNELS } from 'shared/ipcChannels'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const registeredHandlers = new Map<string, RegisteredHandler>()
const ipcHandleMock = vi.fn((channel: string, listener: RegisteredHandler) => {
  registeredHandlers.set(channel, listener)
})

const getStoredAIApiKeysMock = vi.fn()
const setStoredAIApiKeysMock = vi.fn()
const clearStoredAIApiKeysMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
    on: vi.fn(),
  },
}))

vi.mock('#/services/AISecretsStorage', () => ({
  getStoredAIApiKeys: getStoredAIApiKeysMock,
  setStoredAIApiKeys: setStoredAIApiKeysMock,
  clearStoredAIApiKeys: clearStoredAIApiKeysMock,
}))

vi.mock('#/services/AIChatServices', () => ({
  AIChatService: {
    createService: vi.fn(),
  },
}))

vi.mock('#/windowManager', () => ({
  default: {
    send: vi.fn(),
  },
}))

describe('setupAIChatIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    registeredHandlers.clear()
  })

  it('registers storage IPC handlers and wires them to main-process secret storage', async () => {
    getStoredAIApiKeysMock.mockReturnValue({ deepseek: 'stored-key' })
    setStoredAIApiKeysMock.mockReturnValue(undefined)
    clearStoredAIApiKeysMock.mockReturnValue(undefined)

    const { setupAIChatIpcHandlers } = await import('#/ipc/aichat')
    setupAIChatIpcHandlers()

    const getHandler = registeredHandlers.get(IPC_CHANNELS.tasks.aiChat.getStoredApiKeys)
    const setHandler = registeredHandlers.get(IPC_CHANNELS.tasks.aiChat.setStoredApiKeys)
    const clearHandler = registeredHandlers.get(IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys)

    expect(getHandler).toBeTypeOf('function')
    expect(setHandler).toBeTypeOf('function')
    expect(clearHandler).toBeTypeOf('function')

    expect(getHandler?.({})).toEqual({ deepseek: 'stored-key' })

    await expect(setHandler?.({}, { deepseek: 'next-key' })).resolves.toEqual({ success: true })
    expect(setStoredAIApiKeysMock).toHaveBeenCalledWith({ deepseek: 'next-key' })

    await expect(clearHandler?.({})).resolves.toEqual({ success: true })
    expect(clearStoredAIApiKeysMock).toHaveBeenCalledTimes(1)
  })
})
