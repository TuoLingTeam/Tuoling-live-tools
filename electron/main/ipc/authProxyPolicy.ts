export type ProxyRequestConfig = {
  endpoint: string
  method?: string
  body?: object | null
}

export type ProxyRequestResult = {
  success: boolean
  status?: number
  data?: unknown
  error?: { code?: string; message?: string }
}

export type ValidatedProxyRequest = {
  endpoint: string
  method: 'GET' | 'POST'
  url: string
  body?: object | null
}

export const AUTH_PROXY_ALLOWLIST: Array<{ method: 'GET' | 'POST'; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/me$/ },
  { method: 'GET', pattern: /^\/auth\/session-check$/ },
  { method: 'GET', pattern: /^\/status$/ },
  { method: 'GET', pattern: /^\/ai\/trial\/status$/ },
  { method: 'POST', pattern: /^\/ai\/trial\/session$/ },
  { method: 'POST', pattern: /^\/ai\/trial\/report-use$/ },
  { method: 'POST', pattern: /^\/trial\/start$/ },
  { method: 'GET', pattern: /^\/trial\/status\?username=[^&]+$/ },
  { method: 'GET', pattern: /^\/server-time$/ },
  { method: 'POST', pattern: /^\/set-password$/ },
  { method: 'POST', pattern: /^\/change-password$/ },
  { method: 'POST', pattern: /^\/gift-card\/redeem$/ },
  { method: 'GET', pattern: /^\/gift-card\/history\?limit=\d+$/ },
  { method: 'GET', pattern: /^\/config$/ },
  { method: 'POST', pattern: /^\/config\/sync$/ },
  { method: 'GET', pattern: /^\/messages\?limit=\d+$/ },
  { method: 'POST', pattern: /^\/messages\/[^/]+\/read$/ },
  { method: 'POST', pattern: /^\/messages\/read-all$/ },
  { method: 'POST', pattern: /^\/feedback\/submit$/ },
]

export function validateProxyRequestConfig(
  config: ProxyRequestConfig,
  baseUrl: string,
):
  | { ok: true; request: ValidatedProxyRequest }
  | { ok: false; status: number; error: { code: string; message: string } } {
  if (!baseUrl) {
    return {
      ok: false,
      status: 503,
      error: { code: 'auth_proxy_unavailable', message: '云鉴权未启用' },
    }
  }

  const method = (config.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    return {
      ok: false,
      status: 405,
      error: { code: 'method_not_allowed', message: '不支持的鉴权请求方法' },
    }
  }

  if (typeof config.endpoint !== 'string' || !config.endpoint.trim()) {
    return {
      ok: false,
      status: 400,
      error: { code: 'invalid_endpoint', message: '鉴权请求缺少 endpoint' },
    }
  }

  if (method === 'GET' && config.body != null) {
    return {
      ok: false,
      status: 400,
      error: { code: 'invalid_request', message: 'GET 鉴权请求不允许携带 body' },
    }
  }

  try {
    const base = new URL(baseUrl)
    const target = new URL(config.endpoint.trim(), base)

    if (target.origin !== base.origin) {
      return {
        ok: false,
        status: 403,
        error: { code: 'forbidden', message: '不允许跨域鉴权请求' },
      }
    }

    if (target.username || target.password || target.hash) {
      return {
        ok: false,
        status: 403,
        error: { code: 'forbidden', message: '不允许的鉴权请求格式' },
      }
    }

    const endpoint = `${target.pathname}${target.search}`
    const allowed = AUTH_PROXY_ALLOWLIST.some(rule => {
      return rule.method === method && rule.pattern.test(endpoint)
    })

    if (!allowed) {
      return {
        ok: false,
        status: 403,
        error: { code: 'forbidden', message: '不允许的鉴权请求' },
      }
    }

    return {
      ok: true,
      request: {
        endpoint,
        method,
        url: target.toString(),
        body: config.body,
      },
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: { code: 'invalid_endpoint', message: '鉴权请求 endpoint 非法' },
    }
  }
}
