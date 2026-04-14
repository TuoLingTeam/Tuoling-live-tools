import { describe, expect, it } from 'vitest'
import { validateProxyRequestConfig } from '#/ipc/authProxyPolicy'

const BASE_URL = 'https://auth.xiuer.work'

describe('validateProxyRequestConfig', () => {
  it('allows known GET endpoints on the auth origin', () => {
    const result = validateProxyRequestConfig(
      {
        endpoint: '/messages?limit=20',
        method: 'GET',
      },
      BASE_URL,
    )

    expect(result).toEqual({
      ok: true,
      request: {
        endpoint: '/messages?limit=20',
        method: 'GET',
        url: 'https://auth.xiuer.work/messages?limit=20',
        body: undefined,
      },
    })
  })

  it('rejects cross-origin absolute URLs', () => {
    const result = validateProxyRequestConfig(
      {
        endpoint: 'https://evil.example/messages?limit=20',
        method: 'GET',
      },
      BASE_URL,
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: '不允许跨域鉴权请求',
      },
    })
  })

  it('rejects non-allowlisted endpoints even on the same origin', () => {
    const result = validateProxyRequestConfig(
      {
        endpoint: '/admin/export-all-users',
        method: 'GET',
      },
      BASE_URL,
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: '不允许的鉴权请求',
      },
    })
  })

  it('rejects GET requests with a body', () => {
    const result = validateProxyRequestConfig(
      {
        endpoint: '/me',
        method: 'GET',
        body: { force: true },
      },
      BASE_URL,
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: {
        code: 'invalid_request',
        message: 'GET 鉴权请求不允许携带 body',
      },
    })
  })
})
