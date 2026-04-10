import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { AUTH_ZUSTAND_PERSIST_KEY } from '@/constants/authStorageKeys'
import { getMe, getTrialStatus, getUserStatus, startTrial } from '../services/apiClient'
import { configSyncService } from '../services/configSyncService'
import type {
  AuthResponse,
  AuthState,
  LoginCredentials,
  RegisterData,
  SafeUser,
  UserStatus,
} from '../types/auth'
import { mapAuthError } from '../utils/mapAuthError'
import {
  clearRememberedIdentifierIfNeeded,
  clearUserScopedBusinessStorage,
  loadUserBaseSessionData,
  loadUserScopedRuntimeContexts,
  resetUserScopedStores,
  saveAccountsSnapshot,
  syncConfigToCloudSafely,
} from './auth/authSessionOrchestration'
import { stopRuntimeTasksForAllAccounts } from './auth/runtimeCleanup'
import { applyUserStatusSnapshot } from './auth/statusUtils'
import { safeUserFromUsername } from './auth/utils'

type LoginResponseExtended = AuthResponse & {
  data?: LoginCredentials
  status?: number
  requestUrl?: string
  detail?: string
}
type RegisterResponseExtended = AuthResponse & {
  data?: RegisterData
  status?: number
  requestUrl?: string
  detail?: string
}

const AUTH_VERBOSE_LOGS = import.meta.env.VITE_AUTH_VERBOSE_LOGS === 'true'

function debugAuthStore(message: string, payload?: unknown) {
  if (!AUTH_VERBOSE_LOGS) {
    return
  }
  if (payload === undefined) {
    console.debug(message)
    return
  }
  console.debug(message, payload)
}

interface AuthStore extends AuthState {
  /** 仅用于 refresh 流程，与 token（access）一起持久化 */
  refreshToken: string | null
  /** 启动时鉴权是否已完成（用于区分 loading / 登录页 / 主界面） */
  authCheckDone: boolean
  /** 有 token 但 /me 非 401 失败（断网/5xx）：保持已登录，仅提示离线 */
  isOffline: boolean
  /** GET /auth/status 返回的用户状态（只读感知，不做限制） */
  userStatus: UserStatus | null
  // Actions
  login: (
    credentials: LoginCredentials,
  ) => Promise<{ success: boolean; error?: string; rawError?: string; showRegisterHint?: boolean }>
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  /** 启动时调用：无 token→未登录；有 token→GET /me，200→已登录，401→尝试 refresh 后恢复或回登录页，其他→已登录但离线 */
  checkAuth: () => Promise<void>
  setUser: (user: SafeUser | null) => void
  setToken: (token: string | null) => void
  setRefreshToken: (refreshToken: string | null) => void
  /** refresh 失败时由 apiClient 调用：清空 token/refreshToken，回到登录页 */
  clearTokensAndUnauth: () => Promise<void>
  setUserStatus: (userStatus: UserStatus | null) => void
  /** 拉取 /auth/status 并写入 store，同时同步更新 user.plan */
  refreshUserStatus: () => Promise<UserStatus | null>
  /** 调用 POST /auth/trial/start，成功则写入 userStatus；失败不改登录态，返回 errorCode（如 trial_already_used）供弹窗提示 */
  startTrialAndRefresh: () => Promise<
    { success: true; status: UserStatus } | { success: false; errorCode?: string; message?: string }
  >
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      user: null,
      token: null,
      refreshToken: null,
      isLoading: false,
      error: null,
      authCheckDone: false,
      isOffline: false,
      userStatus: null,

      // Login action - 首发版：仅使用主进程认证，移除渲染进程降级逻辑
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true, error: null })
        const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

        debugAuthStore(`[AuthStore] Login request [${requestId}]`, {
          method: 'POST',
          body: { username: credentials.username, password: '***' },
        })

        try {
          const response = (await (
            window as unknown as {
              authAPI: { login: (c: LoginCredentials) => Promise<unknown> }
            }
          ).authAPI.login(credentials)) as LoginResponseExtended

          debugAuthStore(`[AuthStore] Login response [${requestId}]`, {
            success: response.success,
            hasUser: !!response.user,
            status: (response as { status?: number }).status,
            hasDetail: Boolean(
              (response as { detail?: string }).detail ??
                (typeof (response as { error?: unknown }).error === 'string'
                  ? (response as { error?: string }).error
                  : (response as { error?: { message?: string } }).error?.message),
            ),
          })

          if (response.success) {
            const user = response.user ?? safeUserFromUsername(credentials.username)

            set({
              isAuthenticated: true,
              user,
              userStatus: null,
              token: null,
              refreshToken: null,
              isLoading: false,
              error: null,
            })

            // 【数据隔离】登录成功后加载该用户的账号数据和偏好设置
            const userId = user.id || credentials.username
            debugAuthStore('[AuthStore] 登录成功，加载用户数据', { userId })
            loadUserBaseSessionData(userId)
            loadUserScopedRuntimeContexts(userId)

            // 【跨设备同步】从云端加载用户配置
            configSyncService
              .loadFromCloud()
              .then(result => {
                if (result.success) {
                  debugAuthStore('[AuthStore] 云端配置加载成功')
                } else {
                  console.warn('[AuthStore] 云端配置加载失败:', result.error)
                }
              })
              .catch(err => {
                console.error('[AuthStore] 云端配置加载异常:', err)
              })

            // 【修复】同步获取用户状态，确保登录后状态完整
            try {
              const status = await getUserStatus()
              if (status) {
                if (applyUserStatusSnapshot(set, get, status, 'login')) {
                  debugAuthStore('[USER-STATUS] 登录后同步完成', status)
                }
              }
            } catch (error) {
              console.error('[AuthStore] Failed to fetch user status after login:', error)
              // 用户状态获取失败不影响登录成功，但会在控制台记录
            }
            return { success: true }
          }
          const status = (response as { status?: number }).status
          const errorObj = (response as { error?: { code?: string; message?: string } }).error
          const detail = errorObj?.message ?? (response as { detail?: string }).detail ?? ''
          const errorCode = errorObj?.code
          const requestUrl = (response as { requestUrl?: string }).requestUrl
          const errorType = (
            response as {
              errorType?:
                | 'USER_NOT_FOUND'
                | 'INVALID_PASSWORD'
                | 'ACCOUNT_DISABLED'
                | 'SERVER_ERROR'
                | 'UNKNOWN_ERROR'
            }
          ).errorType
          const raw = { status, detail, requestUrl, errorType, errorCode }
          debugAuthStore(`[AuthStore] Login failed [${requestId}]`, {
            status,
            hasDetail: Boolean(detail),
            errorType,
            requestUrlPresent: Boolean(requestUrl),
            errorCode,
          })
          const { userMessage, rawForDev, showRegisterHint } = mapAuthError(raw)
          debugAuthStore(`[AuthStore] Mapped error [${requestId}]`, {
            userMessage,
            rawForDev,
            showRegisterHint,
          })
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            refreshToken: null,
            isLoading: false,
            error: userMessage,
          })
          return { success: false, error: userMessage, rawError: rawForDev, showRegisterHint }
        } catch (error) {
          const { userMessage, rawForDev } = mapAuthError(
            error instanceof Error ? error : { error: String(error) },
          )
          debugAuthStore(`[AuthStore] Login failed [${requestId}] (throw)`, rawForDev)
          set({
            isAuthenticated: false,
            user: null,
            token: null,
            refreshToken: null,
            isLoading: false,
            error: userMessage,
          })
          return { success: false, error: userMessage, rawError: rawForDev }
        }
      },

      // Register action
      register: async (data: RegisterData) => {
        set({ isLoading: true, error: null })

        // 【步骤D】生成请求追踪 ID
        const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

        // 【步骤B】统一错误处理：准备错误信息提取函数
        const extractErrorMessage = (error: unknown, defaultMessage: string): string => {
          // 如果是 AuthResponse 格式的错误
          const err = error as { error?: string } | null | undefined
          if (err?.error) {
            return err.error
          }
          // 如果是 Error 对象
          if (error instanceof Error) {
            return error.message || defaultMessage
          }
          // 如果是字符串
          if (typeof error === 'string') {
            return error
          }
          // 默认错误信息
          return defaultMessage
        }

        try {
          // 【步骤B】记录请求信息（去掉密码，打码处理）
          const payloadForLog = {
            ...data,
            password: '***',
            confirmPassword: '***',
          }
          debugAuthStore(`[AuthStore] Register request [${requestId}]`, payloadForLog)

          const response = (await (
            window as unknown as { authAPI: { register: (d: RegisterData) => Promise<unknown> } }
          ).authAPI.register(data)) as RegisterResponseExtended

          // 【步骤B】记录响应信息（证据链：与后端一致，不看 hasUser/hasToken）
          debugAuthStore(`[AuthStore] Register response [${requestId}]`, {
            success: response.success,
            status: (response as { status?: number }).status,
            responseData: {
              success: response.success,
              user: !!response.user,
            },
          })

          // 成功条件与后端一致：res.status==200 且 res.data.success===true；不依赖 user/token
          if (response.success) {
            if (response.user) {
              set({
                isAuthenticated: true,
                user: response.user,
                token: null,
                refreshToken: null,
                isLoading: false,
                error: null,
              })
              loadUserBaseSessionData(response.user.id)
              loadUserScopedRuntimeContexts(response.user.id)
            } else {
              set({ isLoading: false, error: null })
            }
            debugAuthStore(`[AuthStore] Register success [${requestId}]`)
            return { success: true }
          }
          // 【步骤B】统一错误处理：展示 status + 后端 detail + requestUrl；status 0 时引导尝试手机验证码注册
          const status = (response as { status?: number }).status
          const errorObj = (response as { error?: { code?: string; message?: string } }).error
          const detail =
            errorObj?.message ??
            (response as { detail?: string }).detail ??
            extractErrorMessage(response, '') ??
            ''
          const errorCode = errorObj?.code
          const requestUrl = (response as { requestUrl?: string }).requestUrl
          const isNetworkError = status === 0 || /fetch failed|network|timeout/i.test(detail || '')

          // 使用 mapAuthError 获取友好的错误提示
          let errorMessage: string
          if (isNetworkError) {
            errorMessage = '无法连接认证服务器，请检查网络后重试；也可尝试下方「手机验证码注册」。'
          } else if (errorCode) {
            const { userMessage } = mapAuthError({ status, detail, requestUrl, errorCode })
            errorMessage = userMessage
          } else {
            errorMessage =
              typeof status === 'number'
                ? `注册失败（${status}）：${detail || '(无详情)'}${typeof requestUrl === 'string' ? `（请求地址：${requestUrl}）` : ''}`
                : (detail || '注册失败') +
                  (typeof requestUrl === 'string' ? ` (请求地址: ${requestUrl})` : '')
          }
          debugAuthStore(`[AuthStore] Register failed [${requestId}]`, {
            error: errorMessage,
            status,
            requestUrlPresent: Boolean(requestUrl),
          })

          set({
            isAuthenticated: false,
            user: null,
            token: null,
            isLoading: false,
            error: errorMessage,
          })
          return { success: false, error: errorMessage }
        } catch (error) {
          // 【步骤B】统一错误处理：区分网络错误和其他错误
          // 【步骤E】如果后端不可用/未启动，也要能提示
          let errorMessage: string

          if (error instanceof Error) {
            // 检查是否是网络错误（IPC 调用失败）
            if (
              error.message.includes('IPC') ||
              error.message.includes('invoke') ||
              error.message.includes('timeout')
            ) {
              errorMessage = '无法连接服务器，请确认后端服务已启动/网络可用'
              debugAuthStore(`[AuthStore] Register network error [${requestId}]`, {
                message: error.message,
                stack: error.stack,
              })
            } else {
              errorMessage = error.message || '注册失败，请稍后重试'
              debugAuthStore(`[AuthStore] Register error [${requestId}]`, error)
            }
          } else {
            errorMessage = extractErrorMessage(error, '注册失败，请稍后重试')
            debugAuthStore(`[AuthStore] Register unknown error [${requestId}]`, error)
          }

          // 【步骤B】记录完整的错误信息
          debugAuthStore(`[AuthStore] Register failed [${requestId}]`, {
            error: errorMessage,
            errorType: error instanceof Error ? error.name : typeof error,
          })

          set({
            isAuthenticated: false,
            user: null,
            token: null,
            isLoading: false,
            error: errorMessage,
          })
          return { success: false, error: errorMessage }
        }
      },

      // Logout action
      logout: async () => {
        try {
          await stopRuntimeTasksForAllAccounts('logout')

          // [SECURITY] 调用主进程登出，清理安全存储中的 token
          try {
            await window.authAPI.logout()
          } catch (error) {
            console.error('[AuthStore] Logout API error:', error)
          }
        } catch (error) {
          console.error('Logout error:', error)
        } finally {
          const currentUserId = get().user?.id

          await syncConfigToCloudSafely(
            currentUserId,
            '[AuthStore] 登出前配置同步成功',
            '[AuthStore] 登出前配置同步失败:',
          )
          saveAccountsSnapshot(currentUserId, '[AuthStore] 登出前保存账号数据:')

          set({
            isAuthenticated: false,
            user: null,
            token: null,
            refreshToken: null,
            userStatus: null,
            isLoading: false,
            error: null,
            isOffline: false,
          })

          if (currentUserId) {
            debugAuthStore('[AuthStore] 清理用户业务配置数据（保留账号列表）', currentUserId)
            clearUserScopedBusinessStorage(currentUserId)
          }

          resetUserScopedStores()
          clearRememberedIdentifierIfNeeded()
        }
      },

      // 启动时鉴权：无 token→未登录；有 token→GET /me（内部 401 会尝试 refresh 后重试），200→已登录，401→回登录页，其他→已登录但离线
      checkAuth: async () => {
        set({ isLoading: true, authCheckDone: false })

        try {
          if (typeof window === 'undefined' || !window.authAPI?.getAuthSummary) {
            set({
              isAuthenticated: false,
              user: null,
              token: null,
              refreshToken: null,
              isLoading: false,
              authCheckDone: true,
              isOffline: false,
              error: null,
            })
            return
          }

          const summary = await window.authAPI.getAuthSummary()
          if (!summary.hasToken) {
            set({
              isAuthenticated: false,
              user: null,
              token: null,
              refreshToken: null,
              isLoading: false,
              authCheckDone: true,
              isOffline: false,
            })
            return
          }

          const currentUser = await window.authAPI.getCurrentUser().catch(error => {
            console.warn('[AuthStore] Failed to get current user from main process:', error)
            return null
          })
          const result = await getMe()

          // 【修复】旧 token（无 jti）清理，强制重新登录
          if (!result.ok && result.error?.code === 'token_invalid') {
            console.warn('[AuthStore] 旧 token 无效（无 jti），强制重新登录')
            await get().clearTokensAndUnauth()
            set({
              isLoading: false,
              authCheckDone: true,
              error: '登录已过期，请重新登录',
            })
            // 触发登录对话框
            window.dispatchEvent(new CustomEvent('auth:required'))
            return
          }

          if (result.ok && result.data?.username != null) {
            const user = currentUser ?? get().user ?? safeUserFromUsername(result.data.username)
            const userId = user.id || result.data.username
            set({
              isAuthenticated: true,
              user,
              userStatus: null,
              token: null,
              refreshToken: null,
              isLoading: false,
              authCheckDone: true,
              isOffline: false,
              error: null,
            })

            // 【修复】启动时加载用户所有数据
            debugAuthStore('[AuthStore] 启动鉴权成功，加载用户数据', { userId })
            loadUserBaseSessionData(userId)
            loadUserScopedRuntimeContexts(userId)

            // 【跨设备同步】从云端加载用户配置
            configSyncService
              .loadFromCloud()
              .then(result => {
                if (result.success) {
                  debugAuthStore('[AuthStore] 启动时云端配置加载成功')
                } else {
                  console.warn('[AuthStore] 启动时云端配置加载失败:', result.error)
                }
              })
              .catch(err => {
                console.error('[AuthStore] 启动时云端配置加载异常:', err)
              })

            // 获取并同步用户状态
            getUserStatus()
              .then(status => {
                if (status) {
                  if (applyUserStatusSnapshot(set, get, status, 'checkAuth')) {
                    debugAuthStore('[USER-STATUS]', status)
                  }
                }
              })
              .catch(error => {
                console.error('[AuthStore] Failed to fetch user status:', error)
              })
            return
          }

          if (currentUser) {
            const userId = currentUser.id || currentUser.username
            set({
              isAuthenticated: true,
              user: currentUser,
              userStatus: null,
              token: null,
              refreshToken: null,
              isLoading: false,
              authCheckDone: true,
              isOffline: true,
              error: null,
            })
            loadUserBaseSessionData(userId)
            loadUserScopedRuntimeContexts(userId)
            return
          }

          if (result.status === 401) {
            await get().clearTokensAndUnauth()
            set({ isLoading: false, authCheckDone: true })
            return
          }

          // 断网/超时/5xx：不踢回登录页，保持已登录但离线
          set({
            isAuthenticated: true,
            isLoading: false,
            authCheckDone: true,
            isOffline: true,
          })
        } catch (error) {
          // 【修复】捕获所有异常，确保 authCheckDone 被设置为 true，避免页面一直卡在加载中
          console.error('[AuthStore] checkAuth failed:', error)
          set({
            isAuthenticated: false,
            user: null,
            isLoading: false,
            authCheckDone: true,
            isOffline: false,
            error: error instanceof Error ? error.message : '认证检查失败',
          })
        }
      },

      // Set user
      setUser: (user: SafeUser | null) => set({ user }),

      // Set token
      setToken: (token: string | null) => set({ token }),

      setRefreshToken: (refreshToken: string | null) => set({ refreshToken }),

      /** refresh 失败时由 apiClient 调用：清空 token/refreshToken，回到登录页 */
      clearTokensAndUnauth: async () => {
        const currentUserId = get().user?.id ?? null

        try {
          await window.authAPI.clearTokens()
        } catch (error) {
          console.error('[AuthStore] Failed to clear main-process tokens:', error)
        }

        try {
          await stopRuntimeTasksForAllAccounts('kicked_out_cleanup')
        } catch (error) {
          console.error('[AuthStore] Failed to stop runtime tasks during unauth cleanup:', error)
        }

        saveAccountsSnapshot(currentUserId, '[AuthStore] 失效会话清理前保存账号数据:')

        set({
          isAuthenticated: false,
          user: null,
          token: null,
          refreshToken: null,
          userStatus: null,
          isLoading: false,
          error: null,
          isOffline: false,
          authCheckDone: true,
        })

        clearUserScopedBusinessStorage(currentUserId)
        resetUserScopedStores()
        clearRememberedIdentifierIfNeeded()
      },

      setUserStatus: (userStatus: UserStatus | null) => set({ userStatus }),

      /** 拉取 /auth/status 并写入 store，同时同步更新 user.plan */
      refreshUserStatus: async () => {
        const status = await getUserStatus()
        if (status) {
          if (!applyUserStatusSnapshot(set, get, status, 'refresh')) {
            return null
          }
        }
        return status
      },

      startTrialAndRefresh: async () => {
        const currentUser = get().user
        if (!get().isAuthenticated || !currentUser) {
          return { success: false as const, message: '请先登录' }
        }
        const result = await startTrial()
        debugAuthStore('[AuthStore] startTrial result', result)
        if (!result.ok) {
          return {
            success: false as const,
            errorCode: result.error?.code,
            message: result.error?.message ?? `请求失败（${result.status}）`,
          }
        }
        if (!result.data?.success) {
          return { success: false as const, message: '开通试用失败' }
        }
        const username = get().user?.username ?? ''
        const refreshedStatus = await getUserStatus()
        const statusResult = refreshedStatus ? null : await getTrialStatus(username)
        if (statusResult) {
          debugAuthStore('[AuthStore] getTrialStatus result', statusResult)
        }
        const statusData = statusResult?.ok ? statusResult.data : null
        const userStatus: UserStatus =
          refreshedStatus ??
          (statusData
            ? {
                user_id: get().user?.id,
                username: get().user?.username ?? username,
                status: 'active',
                plan: 'trial',
                max_accounts: 1,
                trial: {
                  start_at:
                    statusData.start_ts != null
                      ? new Date(statusData.start_ts * 1000).toISOString()
                      : null,
                  end_at:
                    statusData.end_ts != null
                      ? new Date(statusData.end_ts * 1000).toISOString()
                      : null,
                  is_active: statusData.active,
                  is_expired: statusData.has_trial && !statusData.active,
                },
              }
            : {
                user_id: get().user?.id,
                username: get().user?.username ?? username,
                status: 'active',
                plan: 'trial',
                max_accounts: 1,
                trial: { is_active: true },
              })
        debugAuthStore('[AuthStore] Setting userStatus after trial', userStatus)
        applyUserStatusSnapshot(set, get, userStatus, 'trial-start')

        return { success: true as const, status: userStatus }
      },

      // Set loading state
      setLoading: (loading: boolean) => set({ isLoading: loading }),

      // Set error
      setError: (error: string | null) => set({ error }),

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: AUTH_ZUSTAND_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // [SECURITY] 敏感认证信息不再持久化到 localStorage
      // token/refreshToken 仅存储在主进程安全存储中
      // user 对象包含敏感信息，也不再持久化
      partialize: state => ({
        // 仅保留 UI 状态，认证状态通过主进程恢复
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)

// Selectors for easier access
export const useUser = () => useAuthStore(state => state.user)
export const useIsAuthenticated = () => useAuthStore(state => state.isAuthenticated)
export const useAuthLoading = () => useAuthStore(state => state.isLoading)
export const useAuthError = () => useAuthStore(state => state.error)
export const useAuthCheckDone = () => useAuthStore(state => state.authCheckDone)
export const useIsOffline = () => useAuthStore(state => state.isOffline)
