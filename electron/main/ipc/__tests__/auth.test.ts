import { IPC_CHANNELS } from 'shared/ipcChannels'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const registeredHandlers = new Map<string, RegisteredHandler>()
const ipcHandleMock = vi.fn((channel: string, listener: RegisteredHandler) => {
  registeredHandlers.set(channel, listener)
})

const getStoredTokensMock = vi.fn()
const clearStoredTokensMock = vi.fn()
const fixTokenFilePermissionsMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}))

vi.mock('#/config/buildTimeConfig', () => ({
  getAuthApiBaseUrl: vi.fn(() => 'https://auth.xiuer.work'),
}))

vi.mock('#/services/CloudAuthStorage', () => ({
  getStoredTokens: getStoredTokensMock,
  clearStoredTokens: clearStoredTokensMock,
  setStoredTokens: vi.fn(),
  fixTokenFilePermissions: fixTokenFilePermissionsMock,
}))

vi.mock('#/services/cloudAuthMappers', () => ({
  cloudUserToSafeUser: vi.fn(),
}))

vi.mock('#/windowManager', () => ({
  default: {
    send: vi.fn(),
  },
}))

describe('setupAuthHandlers proxyRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    registeredHandlers.clear()
    getStoredTokensMock.mockReturnValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('rejects disallowed proxy endpoints before issuing a fetch', async () => {
    const { setupAuthHandlers } = await import('#/ipc/auth')
    setupAuthHandlers()

    const proxyHandler = registeredHandlers.get(IPC_CHANNELS.auth.proxyRequest)
    expect(proxyHandler).toBeTypeOf('function')

    await expect(
      proxyHandler?.({}, { endpoint: 'https://evil.example/me', method: 'GET' }),
    ).resolves.toEqual({
      success: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: '不允许跨域鉴权请求',
      },
    })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('proxies allowlisted requests with the stored bearer token', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, username: 'tester' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const { setupAuthHandlers } = await import('#/ipc/auth')
    setupAuthHandlers()

    const proxyHandler = registeredHandlers.get(IPC_CHANNELS.auth.proxyRequest)
    expect(proxyHandler).toBeTypeOf('function')

    await expect(proxyHandler?.({}, { endpoint: '/me', method: 'GET' })).resolves.toEqual({
      success: true,
      status: 200,
      data: { ok: true, username: 'tester' },
    })

    expect(fetchMock).toHaveBeenCalledWith('https://auth.xiuer.work/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-token',
      },
      body: undefined,
    })
  })
})
