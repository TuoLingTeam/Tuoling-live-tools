import type { IpcInvoke } from 'shared/electron-api'
import type { PlanType } from 'shared/planRules'
import type { BrowserCandidate } from 'shared/browser'
import type { User } from './auth'

export interface AuthAPI {
  register: (data: {
    username: string
    email: string
    password: string
    confirmPassword: string
  }) => Promise<{
    success: boolean
    user?: Omit<User, 'passwordHash'>
    error?: string | { code?: string; message?: string }
    status?: number
    detail?: string
  }>

  login: (credentials: { username: string; password: string; rememberMe?: boolean }) => Promise<{
    success: boolean
    user?: Omit<User, 'passwordHash'>
    error?: string | { code?: string; message?: string }
    errorType?: string
    status?: number
    detail?: string
  }>

  loginWithSms: (
    phone: string,
    code: string,
  ) => Promise<{
    success: boolean
    user?: Omit<User, 'passwordHash'>
    needs_password?: boolean
    error?: string | { code?: string; message?: string }
    status?: number
    responseDetail?: string
  }>

  logout: () => Promise<boolean>

  validateToken: () => Promise<Omit<User, 'passwordHash'> | null>

  getCurrentUser: () => Promise<Omit<User, 'passwordHash'> | null>

  /** 云鉴权：用主进程存储的 refresh_token 恢复会话（启动时调用） */
  restoreSession: () => Promise<{
    success: boolean
    user?: Omit<User, 'passwordHash'>
  }>

  refreshSession: () => Promise<{
    success: boolean
    error?: string | { code?: string; message?: string }
  }>

  getAuthSummary: () => Promise<{ isAuthenticated: boolean; hasToken: boolean }>

  proxyRequest: (requestConfig: {
    endpoint: string
    method?: string
    body?: object | null
  }) => Promise<{
    success: boolean
    status?: number
    data?: unknown
    error?: string | { code?: string; message?: string }
  }>

  startMessageStream: () => Promise<{ success: boolean; error?: string }>

  stopMessageStream: () => Promise<{ success: boolean }>

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
  ) => () => void

  onMessageStreamState: (
    callback: (payload: { connected: boolean; reason?: string }) => void,
  ) => () => void

  checkFeatureAccess: (feature: string) => Promise<{
    featureAccess: {
      can_access: boolean
      requires_auth: boolean
      required_plan: PlanType
    }
    user: Omit<User, 'passwordHash'> | null
  }>

  onAuthStateChanged: (callback: (user: Omit<User, 'passwordHash'> | null) => void) => () => void

  onLoginRequired: (callback: (feature: string) => void) => () => void

  clearTokens: () => Promise<void>
}

export interface AIChatAPI {
  chat: (payload: {
    messages: Array<{ role: string; content: string }>
    apiKey: string
    provider: string
    model: string
    customBaseURL?: string
    temperature?: number
  }) => Promise<unknown>

  normalChat: (payload: {
    messages: Array<{ role: string; content: string }>
    apiKey: string
    provider: string
    model: string
    customBaseURL?: string
    temperature?: number
  }) => Promise<string | null>

  testApiKey: (payload: {
    apiKey: string
    provider: string
    customBaseURL?: string
  }) => Promise<{ success: boolean; error?: string }>

  getStoredApiKeys: () => Promise<Partial<Record<string, string>>>
  setStoredApiKeys: (apiKeys: Record<string, string>) => Promise<{ success: boolean }>
  clearStoredApiKeys: () => Promise<{ success: boolean }>
  onStream: (
    callback: (payload: { chunk?: string; type?: string; done?: boolean }) => void,
  ) => () => void
  onError: (callback: (payload: { error: string }) => void) => () => void
}

export interface AutoReplyAPI {
  sendReply: (accountId: string, message: string) => Promise<boolean>
  exportData: (payload: {
    data: unknown
    format?: 'csv' | 'json'
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openExportFolder: () => Promise<void>
  pinComment: (params: { accountId: string; content: string }) => Promise<void>
}

export interface AutoPopUpAPI {
  fetchGoodsIds: (accountId: string) => Promise<{
    success: boolean
    error?: string
    goodsIds?: number[]
    goods?: Array<{ id: number; title?: string }>
  }>

  scanGoodsKnowledge: (
    accountId: string,
    goodsId: number,
  ) => Promise<{
    success: boolean
    error?: string
    data?: {
      id: number
      title?: string
      priceText?: string
      detailText?: string
      source: 'detail-page' | 'list-item'
    }
  }>
  updateConfig: (accountId: string, config: Partial<AutoPopUpConfig>) => Promise<void>
  registerShortcuts: (
    accountId: string,
    shortcuts: Array<{ accelerator: string; goodsIds: number[] }>,
  ) => Promise<void>
  unregisterShortcuts: (accountId: string) => Promise<void>
}

export interface AutoMessageAPI {
  sendBatchMessages: (accountId: string, messages: string[], count: number) => Promise<void>
}

export interface UpdateAPI {
  getStatus: () => Promise<unknown>
  checkUpdate: (source?: string) => Promise<unknown>
  startDownload: () => Promise<unknown>
  quitAndInstall: () => Promise<unknown>
  rollback: (targetVersion?: string) => Promise<{ success: boolean; error?: string }>
  listBackups: () => Promise<
    Array<{ id: string; version: string; timestamp: number; size: number }>
  >
}

export interface AppAPI {
  openLogFolder: () => Promise<unknown>
  openExternal: (url: string) => Promise<unknown>
  clearLocalLoginData: () => Promise<unknown>
  getHideToTrayTipDismissed: () => Promise<boolean>
  setHideToTrayTipDismissed: (dismissed: boolean) => Promise<unknown>
}

export interface ChromeAPI {
  listBrowsers: (preferEdge?: boolean) => Promise<BrowserCandidate[]>
  selectPath: () => Promise<string | null>
  testBrowser: (browserPath: string) => Promise<{ success: boolean; error?: string }>
  toggleDevTools: () => Promise<unknown>
}

export interface LiveControlAPI {
  connect: (params: {
    browserPath?: string
    headless?: boolean
    storageState?: string
    platform: LiveControlPlatform
    account: Account
    traceId?: string
  }) => Promise<{
    success: boolean
    browserLaunched: boolean
    error?: string
    needsLogin?: boolean
    accountName?: string | null
    streamState?: StreamStatus
    platform?: LiveControlPlatform
  }>
  disconnect: (accountId: string) => Promise<boolean>
  setAutoStartOnLive: (accountId: string, enabled: boolean) => Promise<boolean>
  getLiveRoomUrl: (accountId: string) => Promise<{ success: boolean; url?: string; error?: string }>
}

export interface AccountAPI {
  switchAccount: (account: { id: string; name: string }) => Promise<unknown>
}

export interface LiveStatsAPI {
  exportData: (payload: {
    data: unknown
    format?: 'csv' | 'excel'
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openExportFolder: () => Promise<void>
}

export interface SubAccountAPI {
  getAllAccounts: (workspaceId: string) => Promise<
    Array<{
      id: string
      name: string
      platform: LiveControlPlatform
      status: string
      error?: string
      stats: { totalSent: number; successCount: number; failCount: number }
      hasStorageState: boolean
      liveRoomUrl?: string
      liveRoomStatus?: 'idle' | 'entering' | 'entered' | 'error'
      lastEnterError?: string
    }>
  >
  addAccount: (
    workspaceId: string,
    account: { id: string; name: string; platform: LiveControlPlatform },
  ) => Promise<boolean>
  removeAccount: (workspaceId: string, accountId: string) => Promise<boolean>
  loginAccount: (
    workspaceId: string,
    accountId: string,
  ) => Promise<{
    success: boolean
    error?: string
    session?: {
      status: 'idle' | 'connecting' | 'connected' | 'error'
      error?: string
    }
  }>
  disconnectAccount: (workspaceId: string, accountId: string) => Promise<{ success: boolean }>
  clearStorageState: (workspaceId: string, accountId: string) => Promise<boolean>
  exportAccounts: (workspaceId: string) => Promise<{ success: boolean; data?: string }>
  importAccounts: (
    workspaceId: string,
    jsonData: string,
  ) => Promise<{ success: boolean; added?: number; error?: string }>
  syncAccounts: (
    workspaceId: string,
    accountConfigs: Array<{ id: string; name: string; platform: LiveControlPlatform }>,
  ) => Promise<{ synced: number }>
  start: (workspaceId: string, config: SubAccountInteractionConfig) => Promise<boolean>
  stop: (workspaceId: string) => Promise<boolean>
  enterLiveRoom: (
    workspaceId: string,
    accountId: string,
    liveRoomUrl: string,
  ) => Promise<{ success: boolean; error?: string }>
  enterAllLiveRooms: (
    workspaceId: string,
    liveRoomUrl: string,
    accountIds: string[],
  ) => Promise<{
    success: boolean
    successCount: number
    failedCount: number
    results: Array<{ accountId: string; success: boolean; error?: string }>
    error?: string
  }>
  sendBatch: (
    workspaceId: string,
    count: number,
    messages?: { content: string; weight?: number }[],
  ) => Promise<{ success: boolean; error?: string }>
}

export interface TaskControlAPI {
  stopCommentListener: (accountId: string) => Promise<void>
  stopAutoMessage: (accountId: string) => Promise<boolean>
  stopAutoPopUp: (accountId: string) => Promise<boolean>
  stopSubAccount: (accountId: string) => Promise<boolean>
}

export interface DiagnosticsAPI {
  getAccountTasks: (accountId: string) => Promise<{
    accountId: string
    activeTasks: string[]
    monitorTasks: Array<{
      accountId: string
      taskType: string
      startedAt: number
      stoppedAt?: number
      status: 'running' | 'stopped'
    }>
  }>
}

export interface TaskEventsAPI {
  onAutoMessageStopped: (accountId: string, callback: (id: string) => void) => () => void
  onAutoPopUpStopped: (accountId: string, callback: (id: string) => void) => () => void
  onCommentListenerStopped: (accountId: string, callback: (id: string) => void) => () => void
}

export interface TaskIPC {
  invoke: IpcInvoke
}

declare global {
  interface Window {
    authAPI: AuthAPI
    aiChatAPI: AIChatAPI
    autoReplyAPI: AutoReplyAPI
    autoPopUpAPI: AutoPopUpAPI
    autoMessageAPI: AutoMessageAPI
    updateAPI: UpdateAPI
    appAPI: AppAPI
    chromeAPI: ChromeAPI
    liveControlAPI: LiveControlAPI
    accountAPI: AccountAPI
    liveStatsAPI: LiveStatsAPI
    subAccountAPI: SubAccountAPI
    taskControlAPI: TaskControlAPI
    diagnosticsAPI: DiagnosticsAPI
    taskEventsAPI: TaskEventsAPI
    taskIPC: TaskIPC
  }
}
