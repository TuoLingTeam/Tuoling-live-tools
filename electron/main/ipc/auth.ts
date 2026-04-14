import { ipcMain } from 'electron'
import type { LoginCredentials, RegisterData, SafeUser } from 'shared/auth'
import { getAuthApiBaseUrl } from '#/config/buildTimeConfig'
import { cloudUserToSafeUser } from '#/services/cloudAuthMappers'
import windowManager from '#/windowManager'
import { IPC_CHANNELS } from '../../../shared/ipcChannels'
import {
  type ProxyRequestConfig,
  type ProxyRequestResult,
  validateProxyRequestConfig,
} from './authProxyPolicy'

const getEffectiveBase = (): string => {
  return getAuthApiBaseUrl()
}
const USE_CLOUD_AUTH = !!getEffectiveBase()
const AUTH_VERBOSE_LOGS = process.env.AUTH_VERBOSE_LOGS === 'true'

function debugAuth(message: string, payload?: unknown): void {
  if (!AUTH_VERBOSE_LOGS) {
    return
  }
  if (payload === undefined) {
    console.debug(message)
    return
  }
  console.debug(message, payload)
}

/** [AUTH-AUDIT] 启动时打印当前鉴权配置 */
function logAuthAuditConfig(): void {
  const base = getEffectiveBase() || '(none)'
  console.log('[AUTH-AUDIT] startup config:', {
    USE_CLOUD_AUTH,
    effectiveBase: base,
  })
}

let messageStreamAbortController: AbortController | null = null
let authServiceModulePromise: Promise<typeof import('../services/AuthService')> | null = null
let cloudAuthStorageModulePromise: Promise<typeof import('../services/CloudAuthStorage')> | null =
  null
let cloudAuthClientModulePromise: Promise<typeof import('../services/cloudAuthClient')> | null =
  null

async function getAuthService() {
  if (!authServiceModulePromise) {
    authServiceModulePromise = import('#/services/AuthService')
  }
  return (await authServiceModulePromise).AuthService
}

async function getCloudAuthStorage() {
  if (!cloudAuthStorageModulePromise) {
    cloudAuthStorageModulePromise = import('#/services/CloudAuthStorage')
  }
  return cloudAuthStorageModulePromise
}

async function getCloudAuthClient() {
  if (!cloudAuthClientModulePromise) {
    cloudAuthClientModulePromise = import('#/services/cloudAuthClient')
  }
  return cloudAuthClientModulePromise
}

async function fixCloudTokenPermissions() {
  try {
    const storage = await getCloudAuthStorage()
    storage.fixTokenFilePermissions()
  } catch (error) {
    console.warn('[AUTH-AUDIT] fixTokenFilePermissions failed:', error)
  }
}

function normalizeErrorDetail(
  error: unknown,
  fallbackMessage: string,
): { code?: string; message?: string } {
  if (typeof error === 'string') {
    return { message: error }
  }
  if (error && typeof error === 'object') {
    const detail = error as { code?: string; message?: string; status?: number }
    if (detail.code || detail.message) {
      return { code: detail.code, message: detail.message ?? fallbackMessage }
    }
  }
  return { message: fallbackMessage }
}

function extractErrorDetail(
  text: string,
  statusText: string,
  payload: unknown,
): { code?: string; message?: string } {
  const rawDetail =
    payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail?: unknown }).detail
      : undefined

  let message = text || statusText
  if (typeof rawDetail === 'string') {
    message = rawDetail
  } else if (rawDetail && typeof rawDetail === 'object' && 'message' in rawDetail) {
    message = (rawDetail as { message?: string }).message ?? message
  } else if (Array.isArray(rawDetail) && rawDetail.length > 0) {
    message = rawDetail
      .map(
        (item: { msg?: string; message?: string }) =>
          item?.msg ?? item?.message ?? JSON.stringify(item),
      )
      .join('; ')
  }

  const code =
    rawDetail && typeof rawDetail === 'object' && 'code' in rawDetail
      ? (rawDetail as { code?: string }).code
      : undefined

  return { code, message }
}

async function readJsonResponse(response: Response): Promise<ProxyRequestResult> {
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: extractErrorDetail(text, response.statusText, json),
    }
  }

  return {
    success: true,
    status: response.status,
    data: json,
  }
}

async function storeCloudTokens(
  accessToken: string,
  refreshToken: string | null | undefined,
): Promise<void> {
  const storage = await getCloudAuthStorage()
  storage.setStoredTokens({
    access_token: accessToken,
    refresh_token: refreshToken ?? accessToken,
  })
}

async function refreshStoredCloudSession(): Promise<{
  success: boolean
  accessToken?: string
  error?: { code?: string; message?: string }
}> {
  const storage = await getCloudAuthStorage()
  const { refresh_token } = storage.getStoredTokens()
  if (!refresh_token) {
    storage.clearStoredTokens()
    return { success: false, error: { code: 'token_invalid', message: '缺少 refresh token' } }
  }

  const { cloudRefresh } = await getCloudAuthClient()
  const refreshRes = await cloudRefresh(refresh_token)
  if (!refreshRes.success || !refreshRes.access_token) {
    storage.clearStoredTokens()
    return {
      success: false,
      error: normalizeErrorDetail(refreshRes.error, '刷新会话失败'),
    }
  }

  await storeCloudTokens(refreshRes.access_token, refresh_token)
  return { success: true, accessToken: refreshRes.access_token }
}

async function getSafeCloudUserFromStoredSession(): Promise<SafeUser | null> {
  const storage = await getCloudAuthStorage()
  const { access_token } = storage.getStoredTokens()
  if (!access_token) return null

  const { cloudMe } = await getCloudAuthClient()
  let meRes = await cloudMe(access_token)
  if (meRes.success && meRes.user) {
    return cloudUserToSafeUser(meRes.user)
  }

  const refreshed = await refreshStoredCloudSession()
  if (!refreshed.success || !refreshed.accessToken) {
    return null
  }

  meRes = await cloudMe(refreshed.accessToken)
  if (!meRes.success || !meRes.user) {
    return null
  }

  return cloudUserToSafeUser(meRes.user)
}

async function getStoredSafeUser(): Promise<SafeUser | null> {
  if (USE_CLOUD_AUTH) {
    return getSafeCloudUserFromStoredSession()
  }

  const storage = await getCloudAuthStorage()
  const { access_token } = storage.getStoredTokens()
  if (!access_token) {
    return null
  }

  const AuthService = await getAuthService()
  const user = AuthService.getCurrentUser(access_token)
  return user ? AuthService.sanitizeUser(user) : null
}

async function executeAuthenticatedProxyRequest(
  requestConfig: ProxyRequestConfig,
): Promise<ProxyRequestResult> {
  const validation = validateProxyRequestConfig(requestConfig, getEffectiveBase())
  if (!validation.ok) {
    return {
      success: false,
      status: validation.status,
      error: validation.error,
    }
  }

  const storage = await getCloudAuthStorage()
  const { access_token, refresh_token } = storage.getStoredTokens()
  if (!access_token) {
    return {
      success: false,
      status: 401,
      error: { code: 'token_invalid', message: '未登录或会话已失效' },
    }
  }

  const { url, method, body } = validation.request

  const performRequest = async (token: string) => {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return readJsonResponse(response)
  }

  let result = await performRequest(access_token)
  if (result.success || result.status !== 401 || !refresh_token) {
    if (!result.success && result.status === 401) {
      storage.clearStoredTokens()
    }
    return result
  }

  const refreshed = await refreshStoredCloudSession()
  if (!refreshed.success || !refreshed.accessToken) {
    return {
      success: false,
      status: 401,
      error: refreshed.error ?? { code: 'token_invalid', message: '会话已失效' },
    }
  }

  result = await performRequest(refreshed.accessToken)
  if (!result.success && result.status === 401) {
    storage.clearStoredTokens()
  }
  return result
}

async function ensureCloudUser(
  accessToken: string | undefined,
  user?: Parameters<typeof cloudUserToSafeUser>[0],
): Promise<SafeUser | undefined> {
  if (user) {
    return cloudUserToSafeUser(user)
  }
  if (!accessToken) {
    return undefined
  }
  const { cloudMe } = await getCloudAuthClient()
  const meRes = await cloudMe(accessToken)
  if (!meRes.success || !meRes.user) {
    return undefined
  }
  return cloudUserToSafeUser(meRes.user)
}

function parseMessageStreamEvent(block: string): { type: 'snapshot'; payload: unknown } | null {
  const lines = block.split('\n')
  let eventName = 'message'
  const dataLines: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (eventName !== 'snapshot' || dataLines.length === 0) {
    return null
  }

  try {
    return {
      type: 'snapshot',
      payload: JSON.parse(dataLines.join('\n')),
    }
  } catch {
    return null
  }
}

export function setupAuthHandlers() {
  logAuthAuditConfig()
  void fixCloudTokenPermissions()
  // ----- 云鉴权：恢复会话（启动时 refresh -> me） -----
  ipcMain.handle(IPC_CHANNELS.auth.restoreSession, async () => {
    const user = await getStoredSafeUser()
    return {
      success: !!user,
      user: user ?? undefined,
    }
  })

  ipcMain.handle(IPC_CHANNELS.auth.refreshSession, async () => {
    if (!USE_CLOUD_AUTH) {
      return { success: false, error: '云鉴权未启用' }
    }

    const refreshed = await refreshStoredCloudSession()
    return refreshed.success
      ? { success: true }
      : { success: false, error: refreshed.error ?? { message: '刷新会话失败' } }
  })

  // Register
  ipcMain.handle(IPC_CHANNELS.auth.register, async (_, data: RegisterData) => {
    if (USE_CLOUD_AUTH) {
      const identifier = (data.email || '').trim()
      if (!identifier) {
        return { success: false, error: '请输入手机号或邮箱' }
      }
      const { cloudRegister } = await getCloudAuthClient()
      const res = await cloudRegister(identifier, data.password)
      if (!res.success) {
        // [FIX] 将 error 对象转为字符串
        const errorMessage =
          typeof res.error === 'string'
            ? res.error
            : res.error?.message || res.error?.code || '注册失败'
        return {
          success: false,
          error: normalizeErrorDetail(res.error, errorMessage),
          requestUrl: res.requestUrl,
          status: res.status,
          detail: res.responseDetail,
        }
      }
      if (res.access_token) {
        await storeCloudTokens(res.access_token, res.refresh_token)
      }
      const user = await ensureCloudUser(res.access_token, res.user)
      return {
        success: true,
        user,
      }
    }
    const AuthService = await getAuthService()
    const result = await AuthService.register(data)
    if (result.success && result.token) {
      const storage = await getCloudAuthStorage()
      storage.setStoredTokens({
        access_token: result.token,
        refresh_token: result.token,
      })
    }
    return {
      success: result.success,
      user: result.user,
      error: result.error ? { message: result.error } : undefined,
    }
  })

  // Login
  ipcMain.handle(IPC_CHANNELS.auth.login, async (_, credentials: LoginCredentials) => {
    if (USE_CLOUD_AUTH) {
      const identifier = (credentials.username || '').trim()
      if (!identifier) {
        return { success: false, error: '请输入手机号或邮箱' }
      }
      const { cloudLogin } = await getCloudAuthClient()
      const res = await cloudLogin(identifier, credentials.password)
      if (!res.success) {
        // 根据后端返回的错误信息判断错误类型
        let errorType: string | undefined
        // error 可能是字符串或对象 {code, message}
        const errorStr = typeof res.error === 'string' ? res.error : JSON.stringify(res.error || '')
        const errorMsg = errorStr.toLowerCase()
        const responseDetail = (res.responseDetail || '').toLowerCase()
        const combinedError = `${errorMsg} ${responseDetail}`

        debugAuth('[AUTH-DEBUG] Login error', {
          status: res.status,
          hasError: Boolean(res.error),
          hasResponseDetail: Boolean(res.responseDetail),
          errorFingerprint: combinedError.slice(0, 120),
        })

        // 根据状态码和错误信息判断错误类型
        // 注意：后端对于"账号不存在"和"密码错误"都返回 401 + "Invalid credentials"
        // 所以无法准确区分，不设置具体的 errorType，让前端显示通用提示
        if (res.status === 403) {
          errorType = 'ACCOUNT_DISABLED'
        }
        // 401 错误不设置 errorType，前端会显示"账号或密码错误"并引导注册

        debugAuth('[AUTH-DEBUG] Determined errorType', { errorType })

        const errorMessage = res.error?.message || res.error?.code || '登录失败'
        return {
          success: false,
          error: normalizeErrorDetail(res.error, errorMessage),
          errorType,
          requestUrl: res.requestUrl,
          status: res.status,
          detail: res.responseDetail,
        }
      }
      if (res.access_token) {
        await storeCloudTokens(res.access_token, res.refresh_token)
      }
      const user = await ensureCloudUser(res.access_token, res.user)
      return {
        success: true,
        user,
      }
    }
    const AuthService = await getAuthService()
    const result = await AuthService.login(credentials)
    if (result.success && result.token) {
      const storage = await getCloudAuthStorage()
      storage.setStoredTokens({
        access_token: result.token,
        refresh_token: result.token,
      })
    }
    return {
      success: result.success,
      user: result.user,
      error: result.error ? { message: result.error } : undefined,
      errorType: result.errorType,
    }
  })

  // SMS Login - 手机验证码登录（内部处理 token 存储）
  ipcMain.handle(IPC_CHANNELS.auth.loginWithSms, async (_, phone: string, code: string) => {
    if (!USE_CLOUD_AUTH) {
      return { success: false, error: '云鉴权未启用' }
    }
    const { cloudSmsLogin } = await getCloudAuthClient()
    const res = await cloudSmsLogin(phone, code)
    if (!res.success) {
      const errorMessage =
        typeof res.error === 'string'
          ? res.error
          : res.error?.message || res.error?.code || '验证码登录失败'
      return {
        success: false,
        error: normalizeErrorDetail(res.error, errorMessage),
        status: res.status,
        responseDetail: res.responseDetail,
      }
    }
    if (res.access_token) {
      try {
        await storeCloudTokens(res.access_token, res.refresh_token)
      } catch (_err) {
        return { success: false, error: 'Token存储失败' }
      }
    } else {
      return { success: false, error: '登录响应缺少token' }
    }
    const user = await ensureCloudUser(res.access_token, res.user)
    return {
      success: true,
      user,
      needs_password: res.needs_password,
    }
  })

  // Logout
  ipcMain.handle(IPC_CHANNELS.auth.logout, async () => {
    const storage = await getCloudAuthStorage()
    const { access_token } = storage.getStoredTokens()
    if (USE_CLOUD_AUTH) {
      storage.clearStoredTokens()
      return true
    }
    const AuthService = await getAuthService()
    const result = access_token ? AuthService.logout(access_token) : true
    storage.clearStoredTokens()
    return result
  })

  // Get current user（优先使用主进程安全存储中的会话）
  ipcMain.handle(IPC_CHANNELS.auth.getCurrentUser, async () => {
    return getStoredSafeUser()
  })

  // Validate token
  ipcMain.handle(IPC_CHANNELS.auth.validateToken, async () => {
    return getStoredSafeUser()
  })

  // Check feature access（IPC 只暴露 SafeUser）
  ipcMain.handle(IPC_CHANNELS.auth.checkFeatureAccess, async (_, feature: string) => {
    const user = await getStoredSafeUser()
    const AuthService = await getAuthService()
    const requiresAuth = AuthService.requiresAuthentication(feature)
    const requiredPlan = AuthService.getRequiredPlan(feature)
    const featureAccess = {
      can_access: !requiresAuth || AuthService.hasPlanLevel(user, requiredPlan),
      requires_auth: requiresAuth,
      required_plan: requiredPlan,
    }
    return {
      featureAccess,
      user,
    }
  })

  // [SECURITY-FIX] Token 管理接口已收紧
  // renderer 不再直接获取/设置完整 token，仅通过最小必要接口操作

  /**
   * [SECURITY] 获取认证状态摘要（最小必要信息）
   * 替代 auth:getTokens，不返回完整 token
   */
  ipcMain.handle(IPC_CHANNELS.auth.getAuthSummary, async () => {
    const storage = await getCloudAuthStorage()
    const tokens = storage.getStoredTokens()
    // 不返回 token 内容，只返回是否存在
    return {
      isAuthenticated: !!tokens.access_token,
      hasToken: !!tokens.access_token,
    }
  })

  /**
   * [SECURITY] 内部使用：主进程代发带鉴权请求
   * renderer 提供请求配置，main 负责附加 token 并执行
   * 这是替代直接暴露 token 的安全方案
   */
  ipcMain.handle(IPC_CHANNELS.auth.proxyRequest, async (_, requestConfig: ProxyRequestConfig) => {
    return executeAuthenticatedProxyRequest(requestConfig)
  })

  ipcMain.handle(IPC_CHANNELS.auth.startMessageStream, async () => {
    if (!USE_CLOUD_AUTH) {
      return { success: false, error: '云鉴权未启用' }
    }

    if (messageStreamAbortController) {
      messageStreamAbortController.abort()
      messageStreamAbortController = null
    }

    const storage = await getCloudAuthStorage()
    const { access_token } = storage.getStoredTokens()
    if (!access_token) {
      return { success: false, error: '未登录或会话已失效' }
    }

    const controller = new AbortController()
    messageStreamAbortController = controller
    windowManager.send(IPC_CHANNELS.auth.messageStreamState, { connected: true })

    try {
      const openStream = async (token: string) =>
        fetch(`${getEffectiveBase()}/messages/stream`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal: controller.signal,
        })

      let response = await openStream(access_token)
      if (response.status === 401) {
        const refreshed = await refreshStoredCloudSession()
        if (refreshed.success && refreshed.accessToken) {
          response = await openStream(refreshed.accessToken)
        }
      }

      if (!response.ok || !response.body) {
        const failure = await readJsonResponse(response)
        const reason = failure.error?.message || `message_stream_http_${response.status}`
        windowManager.send(IPC_CHANNELS.auth.messageStreamState, {
          connected: false,
          reason,
        })
        return { success: false, error: reason }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
          let separatorIndex = buffer.indexOf('\n\n')
          while (separatorIndex >= 0) {
            const block = buffer.slice(0, separatorIndex)
            buffer = buffer.slice(separatorIndex + 2)
            const event = parseMessageStreamEvent(block)
            if (event?.type === 'snapshot') {
              windowManager.send(IPC_CHANNELS.auth.messageStreamSnapshot, event.payload)
            }
            separatorIndex = buffer.indexOf('\n\n')
          }
        }

        buffer += decoder.decode().replace(/\r\n/g, '\n')
        const finalEvent = parseMessageStreamEvent(buffer)
        if (finalEvent?.type === 'snapshot') {
          windowManager.send(IPC_CHANNELS.auth.messageStreamSnapshot, finalEvent.payload)
        }
      } finally {
        reader.releaseLock()
      }

      const reason = controller.signal.aborted ? 'aborted' : 'disconnected'
      windowManager.send(IPC_CHANNELS.auth.messageStreamState, {
        connected: false,
        reason,
      })
      return {
        success: !controller.signal.aborted,
        error: controller.signal.aborted ? 'aborted' : undefined,
      }
    } catch (error) {
      const reason = controller.signal.aborted
        ? 'aborted'
        : error instanceof Error
          ? error.message
          : String(error)
      windowManager.send(IPC_CHANNELS.auth.messageStreamState, {
        connected: false,
        reason,
      })
      return { success: false, error: reason }
    } finally {
      if (messageStreamAbortController === controller) {
        messageStreamAbortController = null
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.auth.stopMessageStream, async () => {
    if (messageStreamAbortController) {
      messageStreamAbortController.abort()
      messageStreamAbortController = null
    }
    return { success: true }
  })

  /**
   * [DEPRECATED-SECURITY] auth:setTokens 已收紧
   * 仅允许内部使用，renderer 不应直接设置 token
   * 登录/注册流程由 main 进程内部完成 token 存储
   */
  // ipcMain.handle('auth:setTokens', ... ) // REMOVED - 登录流程内部处理

  ipcMain.handle(IPC_CHANNELS.auth.clearTokens, async () => {
    const storage = await getCloudAuthStorage()
    storage.clearStoredTokens()
  })
}
