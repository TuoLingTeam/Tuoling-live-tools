import { contextBridge, ipcRenderer } from 'electron'
import type { SafeUser } from '../../shared/auth'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

/**
 * [SECURITY-FIX] 认证 API 已收紧
 * - 移除 renderer 直接读取 token 的能力
 * - 新增 getAuthSummary 获取最小必要信息
 * - 新增 proxyRequest 由 main 代发鉴权请求
 */
export const authAPI = {
  // Authentication
  register: async (data: {
    username: string
    email: string
    password: string
    confirmPassword: string
  }) => {
    // 使用真实后端（IPC）
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.register, data)
  },

  login: async (credentials: { username: string; password: string; rememberMe?: boolean }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.login, credentials)
  },

  /**
   * 手机验证码登录（内部处理 token 存储）
   * 成功后 token 已写入主进程安全存储
   */
  loginWithSms: async (
    phone: string,
    code: string,
  ): Promise<{
    success: boolean
    user?: { id: string; username: string; email?: string; phone?: string; status?: string }
    needs_password?: boolean
    error?: string | { code?: string; message?: string }
    status?: number
    responseDetail?: string
  }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.loginWithSms, phone, code)
  },

  logout: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.auth.logout)
  },

  validateToken: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.auth.validateToken)
  },

  getCurrentUser: async () => {
    return ipcRenderer.invoke(IPC_CHANNELS.auth.getCurrentUser)
  },

  /** 云鉴权：用主进程存储的 refresh_token 恢复会话（启动时调用） */
  restoreSession: async (): Promise<{
    success: boolean
    user?: SafeUser
  }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.restoreSession)
  },

  refreshSession: async (): Promise<{
    success: boolean
    error?: string | { code?: string; message?: string }
  }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.refreshSession)
  },

  // [SECURITY-FIX] Token 管理接口已收紧
  // renderer 不再直接获取完整 token

  /**
   * [SECURITY] 获取认证状态摘要（最小必要信息）
   * 替代 getTokens，不返回完整 token 内容
   */
  getAuthSummary: async (): Promise<{ isAuthenticated: boolean; hasToken: boolean }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.getAuthSummary)
  },

  /**
   * [SECURITY] 主进程代发带鉴权请求
   * renderer 提供请求配置，main 负责附加 token 并执行
   * 这是替代直接暴露 token 的安全方案
   */
  proxyRequest: async (requestConfig: {
    endpoint: string
    method?: string
    body?: object | null
  }): Promise<{
    success: boolean
    status?: number
    data?: unknown
    error?: string | { code?: string; message?: string }
  }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.proxyRequest, requestConfig)
  },

  startMessageStream: async (): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.startMessageStream)
  },

  stopMessageStream: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.stopMessageStream)
  },

  clearTokens: async (): Promise<void> => {
    return await ipcRenderer.invoke(IPC_CHANNELS.auth.clearTokens)
  },

  // Feature access
  checkFeatureAccess: (feature: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.auth.checkFeatureAccess, feature),

  // Events
  onAuthStateChanged: (callback: (user: SafeUser | null) => void) => {
    const listener = (_event: unknown, user: SafeUser | null) => callback(user)
    ipcRenderer.on(IPC_CHANNELS.auth.stateChanged, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.auth.stateChanged, listener)
  },

  onLoginRequired: (callback: (feature: string) => void) => {
    const listener = (_event: unknown, feature: string) => callback(feature)
    ipcRenderer.on(IPC_CHANNELS.auth.loginRequired, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.auth.loginRequired, listener)
  },

  onMessageStreamSnapshot: (
    callback: (payload: {
      success: boolean
      items: Array<{
        id: string
        title: string
        content: string
        type: 'notice' | 'update' | 'warning' | 'marketing'
        is_pinned: boolean
        is_read: boolean
        created_at: string | null
        published_at: string | null
        expires_at: string | null
      }>
      unread_count: number
      fetched_at: string | null
    }) => void,
  ) => {
    const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.auth.messageStreamSnapshot, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.auth.messageStreamSnapshot, listener)
  },

  onMessageStreamState: (callback: (payload: { connected: boolean; reason?: string }) => void) => {
    const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on(IPC_CHANNELS.auth.messageStreamState, listener)
    return () => ipcRenderer.off(IPC_CHANNELS.auth.messageStreamState, listener)
  },
}

contextBridge.exposeInMainWorld('authAPI', authAPI)
