import type { LogMessage } from 'electron-log'
import type { ProgressInfo, UpdateDownloadedEvent } from 'electron-updater'
import type { AIChatContextMessage } from 'shared/aiChat'
import type { BrowserCandidate, BrowserTestResult } from 'shared/browser'
import type { PlanType } from 'shared/planRules'
import type { providers } from 'shared/providers'

import { IPC_CHANNELS } from './ipcChannels'

export interface IpcChannels {
  [IPC_CHANNELS.diagnostics.getRuntimeStats]: () => {
    totalTasks: number
    runningTasks: number
    stoppedTasks: number
    activeTimers: number
    activeListeners: number
    tasksByAccount: Map<
      string,
      Array<{
        accountId: string
        taskType: string
        startedAt: number
        stoppedAt?: number
        status: 'running' | 'stopped'
      }>
    >
  }
  [IPC_CHANNELS.diagnostics.getAccountTasks]: (accountId: string) => {
    accountId: string
    activeTasks: string[]
    monitorTasks: Array<{
      accountId: string
      taskType: string
      startedAt: number
      stoppedAt?: number
      status: 'running' | 'stopped'
    }>
  }
  [IPC_CHANNELS.diagnostics.getTimeline]: () => Array<{
    time: string
    event: string
    accountId: string
    data?: unknown
  }>
  [IPC_CHANNELS.diagnostics.printSummary]: () => { success: boolean }
  [IPC_CHANNELS.diagnostics.reset]: () => { success: boolean; message: string }

  // Auth
  [IPC_CHANNELS.auth.register]: (data: {
    username: string
    email: string
    password: string
    confirmPassword: string
  }) => {
    success: boolean
    user?: { id: string; username: string; email?: string; phone?: string; status?: string }
    error?: string | { code?: string; message?: string }
    status?: number
    detail?: string
  }
  [IPC_CHANNELS.auth.login]: (credentials: {
    username: string
    password: string
    rememberMe?: boolean
  }) => {
    success: boolean
    user?: { id: string; username: string; email?: string; phone?: string; status?: string }
    error?: string | { code?: string; message?: string }
    errorType?: string
    status?: number
    detail?: string
  }
  [IPC_CHANNELS.auth.loginWithSms]: (
    phone: string,
    code: string,
  ) => {
    success: boolean
    user?: { id: string; username: string; email?: string; phone?: string; status?: string }
    needs_password?: boolean
    error?: string | { code?: string; message?: string }
    status?: number
    responseDetail?: string
  }
  [IPC_CHANNELS.auth.logout]: () => boolean
  [IPC_CHANNELS.auth.validateToken]: () => {
    id: string
    username: string
    email?: string
    phone?: string
    status?: string
  } | null
  [IPC_CHANNELS.auth.getCurrentUser]: () => {
    id: string
    username: string
    email?: string
    phone?: string
    status?: string
  } | null
  [IPC_CHANNELS.auth.restoreSession]: () => {
    success: boolean
    user?: { id: string; username: string; email?: string; phone?: string; status?: string }
  }
  [IPC_CHANNELS.auth.refreshSession]: () => {
    success: boolean
    error?: string | { code?: string; message?: string }
  }
  [IPC_CHANNELS.auth.getAuthSummary]: () => { isAuthenticated: boolean; hasToken: boolean }
  [IPC_CHANNELS.auth.proxyRequest]: (requestConfig: {
    endpoint: string
    method?: string
    body?: object | null
  }) => {
    success: boolean
    status?: number
    data?: unknown
    error?: string | { code?: string; message?: string }
  }
  [IPC_CHANNELS.auth.startMessageStream]: () => { success: boolean; error?: string }
  [IPC_CHANNELS.auth.stopMessageStream]: () => { success: boolean }
  [IPC_CHANNELS.auth.messageStreamSnapshot]: (payload: {
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
  }) => void
  [IPC_CHANNELS.auth.messageStreamState]: (payload: { connected: boolean; reason?: string }) => void
  [IPC_CHANNELS.auth.clearTokens]: () => void
  [IPC_CHANNELS.auth.checkFeatureAccess]: (feature: string) => {
    featureAccess: {
      can_access: boolean
      requires_auth: boolean
      required_plan: PlanType
    }
    user: { id: string; username: string; email?: string; phone?: string; status?: string } | null
  }
  [IPC_CHANNELS.auth.updateUserProfile]: (data: { username?: string; email?: string }) => {
    success: boolean
    error?: string
  }
  [IPC_CHANNELS.auth.changePassword]: (data: { currentPassword: string; newPassword: string }) => {
    success: boolean
    error?: string
  }
  [IPC_CHANNELS.auth.stateChanged]: (
    user: { id: string; username: string; email?: string; phone?: string; status?: string } | null,
  ) => void
  [IPC_CHANNELS.auth.loginRequired]: (feature: string) => void

  // LiveControl
  [IPC_CHANNELS.tasks.liveControl.connect]: (params: {
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
  }>
  [IPC_CHANNELS.tasks.liveControl.stateChanged]: (params: {
    accountId: string
    connectState: {
      status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
      phase:
        | 'idle'
        | 'preparing'
        | 'recovering'
        | 'launching_browser'
        | 'waiting_for_login'
        | 'verifying_session'
        | 'streaming'
        | 'tasks_running'
        | 'error'
      error?: string | null
      session?: string | null
      lastVerifiedAt?: number | null
    }
  }) => void
  [IPC_CHANNELS.tasks.liveControl.waitingForLogin]: (accountId: string) => void
  [IPC_CHANNELS.tasks.liveControl.disconnect]: (accountId: string) => boolean
  [IPC_CHANNELS.tasks.liveControl.disconnectedEvent]: (id: string, reason?: string) => void
  [IPC_CHANNELS.tasks.liveControl.notifyAccountName]: (
    params:
      | {
          ok: true
          accountId: string
          accountName: string | null
        }
      | { ok: false },
  ) => void
  [IPC_CHANNELS.tasks.liveControl.streamStateChanged]: (
    accountId: string,
    streamState: import('shared/streamStatus').StreamStatus,
  ) => void
  [IPC_CHANNELS.tasks.liveControl.reconnectedEvent]: (
    accountId: string,
    payload: { success: boolean },
  ) => void
  [IPC_CHANNELS.tasks.liveControl.reconnectFailedEvent]: (
    accountId: string,
    payload: { reason: string; message: string },
  ) => void
  [IPC_CHANNELS.tasks.liveControl.getLiveRoomUrl]: (
    accountId: string,
  ) => Promise<{ success: boolean; url?: string; error?: string }>

  // AutoMessage
  [IPC_CHANNELS.tasks.autoMessage.start]: (accountId: string, config: AutoCommentConfig) => boolean
  [IPC_CHANNELS.tasks.autoMessage.stop]: (accountId: string) => boolean
  /** 账号隔离的停止事件 */
  [key: `tasks:autoMessage:stopped:${string}`]: (id: string) => void
  [IPC_CHANNELS.tasks.autoMessage.sendBatchMessages]: (
    accountId: string,
    messages: string[],
    count: number,
  ) => boolean
  [IPC_CHANNELS.tasks.autoMessage.updateConfig]: (
    accountId: string,
    config: Partial<AutoCommentConfig>,
  ) => void

  // AutoPopup
  [IPC_CHANNELS.tasks.autoPopUp.start]: (accountId: string, config: AutoPopupConfig) => boolean
  [IPC_CHANNELS.tasks.autoPopUp.stop]: (accountId: string) => boolean
  /** 账号隔离的停止事件 */
  [key: `tasks:autoPopUp:stopped:${string}`]: (id: string) => void
  [IPC_CHANNELS.tasks.autoPopUp.updateConfig]: (
    accountId: string,
    config: Partial<AutoPopupConfig>,
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.fetchGoodsIds]: (accountId: string) => Promise<{
    success: boolean
    goodsIds?: number[]
    goods?: GoodsScanItem[]
    error?: string
  }>
  [IPC_CHANNELS.tasks.autoPopUp.scanGoodsKnowledge]: (
    accountId: string,
    goodsId: number,
  ) => Promise<{
    success: boolean
    data?: {
      id: number
      title?: string
      priceText?: string
      detailText?: string
      source: 'detail-page' | 'list-item'
    }
    error?: string
  }>
  [IPC_CHANNELS.tasks.autoPopUp.registerShortcuts]: (
    accountId: string,
    shortcuts: { accelerator: string; goodsIds: number[] }[],
  ) => void
  [IPC_CHANNELS.tasks.autoPopUp.unregisterShortcuts]: (accountId: string) => void

  // CommentListener
  [IPC_CHANNELS.tasks.commentListener.start]: (
    accountId: string,
    config: CommentListenerConfig,
  ) => boolean
  [IPC_CHANNELS.tasks.commentListener.stop]: (accountId: string) => void
  /** 账号隔离的监听器停止事件 */
  [key: `tasks:commentListener:stopped:${string}`]: (accountId: string) => void
  [IPC_CHANNELS.tasks.commentListener.showComment]: (data: {
    comment: LiveMessage
    accountId: string
  }) => void

  // AutoReply
  [IPC_CHANNELS.tasks.autoReply.sendReply]: (accountId: string, replyContent: string) => boolean
  [IPC_CHANNELS.tasks.autoReply.exportData]: (payload: {
    data: {
      accountName: string
      exportedAt: number
      stats: {
        totalComments: number
        totalReplies: number
        sentReplies: number
        rewrittenReplies: number
      }
      rows: Array<{
        sessionId?: string
        sessionStartedAt?: string
        sessionEndedAt?: string
        commentId: string
        commentTime: string
        nickname: string
        commentContent: string
        replyTime?: string
        replyContent?: string
        isSent: boolean
        source: 'ai' | 'product-kb' | 'none'
        replyIntent?: string
        questionType?: string
        factStatus?: string
        guardrailAction?: string
        guardrailReason?: string
        knowledgeMissReason?: string
        matchedSlotIndex?: number
        matchedTitle?: string
        matchedFields?: string[]
      }>
    }
    format?: 'csv' | 'json'
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  [IPC_CHANNELS.tasks.autoReply.openExportFolder]: () => void

  // AIChat
  [IPC_CHANNELS.tasks.aiChat.normalChat]: (params: {
    messages: AIChatContextMessage[]
    provider: keyof typeof providers
    model: string
    apiKey: string
    customBaseURL?: string
  }) => string | null
  [IPC_CHANNELS.tasks.aiChat.testApiKey]: (params: {
    apiKey: string
    provider: keyof typeof providers
    customBaseURL?: string
  }) => { success: boolean; models?: string[]; error?: string }
  [IPC_CHANNELS.tasks.aiChat.getStoredApiKeys]: () => Partial<
    Record<keyof typeof providers, string>
  >
  [IPC_CHANNELS.tasks.aiChat.setStoredApiKeys]: (
    apiKeys: Partial<Record<keyof typeof providers, string>>,
  ) => { success: boolean }
  [IPC_CHANNELS.tasks.aiChat.clearStoredApiKeys]: () => { success: boolean }
  [IPC_CHANNELS.tasks.aiChat.chat]: (params: {
    messages: AIChatContextMessage[]
    provider: keyof typeof providers
    model: string
    apiKey: string
    customBaseURL?: string
  }) => void
  [IPC_CHANNELS.tasks.aiChat.stream]: (
    data:
      | {
          chunk: string
          type: 'content' | 'reasoning'
        }
      | { done: boolean },
  ) => void
  [IPC_CHANNELS.tasks.aiChat.error]: (data: { error: string }) => void

  // 视频号上墙
  [IPC_CHANNELS.tasks.pinComment]: (params: { accountId: string; content: string }) => void

  // 小号互动
  [IPC_CHANNELS.tasks.subAccount.start]: (
    accountId: string,
    config: SubAccountInteractionConfig,
  ) => boolean
  [IPC_CHANNELS.tasks.subAccount.stop]: (accountId: string) => boolean
  /** 账号隔离的停止事件 */
  [key: `tasks:subAccount:stopped:${string}`]: (accountId: string) => void
  [IPC_CHANNELS.tasks.subAccount.updateConfig]: (
    accountId: string,
    config: Partial<SubAccountInteractionConfig>,
  ) => void
  [IPC_CHANNELS.tasks.subAccount.addAccount]: (
    accountId: string,
    subAccount: SubAccountConfig,
  ) => boolean
  [IPC_CHANNELS.tasks.subAccount.removeAccount]: (
    accountId: string,
    subAccountId: string,
  ) => boolean
  [IPC_CHANNELS.tasks.subAccount.loginAccount]: (
    accountId: string,
    subAccountId: string,
  ) => Promise<{
    success: boolean
    error?: string
    session?: {
      status: 'idle' | 'connecting' | 'connected' | 'error'
      error?: string
    }
  }>
  [IPC_CHANNELS.tasks.subAccount.disconnectAccount]: (
    accountId: string,
    subAccountId: string,
  ) => Promise<{ success: boolean }>
  [IPC_CHANNELS.tasks.subAccount.accountStatusChanged]: (
    accountId: string,
    data: {
      accountId: string
      accountName?: string
      message?: string
      status?: 'idle' | 'connecting' | 'connected' | 'error'
      liveRoomStatus?: 'idle' | 'entering' | 'entered' | 'error'
      lastEnterError?: string
      verificationRequired?: boolean
      verificationMessage?: string
      error?: string
      timestamp: number
    },
  ) => void
  [IPC_CHANNELS.tasks.subAccount.sendBatch]: (
    accountId: string,
    count: number,
    messages?: { content: string; weight?: number }[],
  ) => Promise<{ success: boolean; error?: string }>
  [IPC_CHANNELS.tasks.subAccount.batchProgress]: (
    accountId: string,
    data: {
      current: number
      total: number
      completed: number
      failed: number
    },
  ) => void
  [IPC_CHANNELS.tasks.subAccount.enterAllLiveRooms]: (
    accountId: string,
    liveRoomUrl: string,
    accountIds: string[],
  ) => Promise<{
    success: boolean
    successCount: number
    failedCount: number
    results: Array<{ accountId: string; success: boolean; error?: string }>
    error?: string
  }>
  [IPC_CHANNELS.tasks.subAccount.enterAllProgress]: (
    accountId: string,
    data: {
      current: number
      total: number
      completed: number
      failed: number
      accountId: string
      accountName: string
      success: boolean
      error?: string
    },
  ) => void
  [IPC_CHANNELS.tasks.subAccount.checkHealth]: (
    accountId: string,
    subAccountId: string,
  ) => Promise<{ status: 'healthy' | 'warning' | 'error'; message?: string }>
  [IPC_CHANNELS.tasks.subAccount.enterLiveRoom]: (
    accountId: string,
    subAccountId: string,
    liveRoomUrl: string,
  ) => Promise<{ success: boolean; error?: string }>
  [IPC_CHANNELS.tasks.subAccount.getAllAccounts]: (accountId: string) => Array<{
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
  [IPC_CHANNELS.tasks.subAccount.clearStorageState]: (
    accountId: string,
    subAccountId: string,
  ) => boolean
  [IPC_CHANNELS.tasks.subAccount.exportAccounts]: (accountId: string) => {
    success: boolean
    data?: string
  }
  [IPC_CHANNELS.tasks.subAccount.importAccounts]: (
    accountId: string,
    jsonData: string,
  ) => { success: boolean; added?: number; error?: string }
  [IPC_CHANNELS.tasks.subAccount.syncAccounts]: (
    accountId: string,
    accountConfigs: Array<{ id: string; name: string; platform: LiveControlPlatform }>,
  ) => { synced: number }

  // Updater
  [IPC_CHANNELS.updater.getStatus]: () => Promise<{
    platform: NodeJS.Platform
    canUpdate: boolean
    capabilities: {
      checkUpdate: boolean
      startDownload: boolean
      quitAndInstall: boolean
      pauseDownload: boolean
      resumeDownload: boolean
      cancelDownload: boolean
      rollback: boolean
      listBackups: boolean
    }
  }>
  [IPC_CHANNELS.updater.listBackups]: () => Promise<
    Array<{
      id: string
      version: string
      timestamp: number
      size: number
    }>
  >
  [IPC_CHANNELS.updater.rollback]: (targetVersion?: string) => Promise<{
    success: boolean
    error?: string
  }>
  [IPC_CHANNELS.updater.checkUpdate]: (source?: string) => Promise<
    | {
        update: boolean
        version: string
        newVersion: string
        releaseNote?: string
      }
    | undefined
    | null
  >
  [IPC_CHANNELS.updater.startDownload]: () => void
  [IPC_CHANNELS.updater.quitAndInstall]: () => void
  [IPC_CHANNELS.updater.updateAvailable]: (info: {
    update: boolean
    version: string
    newVersion: string
    releaseNote?: string
  }) => void
  [IPC_CHANNELS.updater.updateError]: (error: ErrorType) => void
  [IPC_CHANNELS.updater.downloadProgress]: (progress: ProgressInfo) => void
  [IPC_CHANNELS.updater.updateDownloaded]: (event?: UpdateDownloadedEvent) => void

  // Chrome
  [IPC_CHANNELS.chrome.selectPath]: () => string | null
  [IPC_CHANNELS.chrome.listBrowsers]: (preferEdge?: boolean) => Promise<BrowserCandidate[]>
  [IPC_CHANNELS.chrome.getPath]: (edge?: boolean) => string | null
  [IPC_CHANNELS.chrome.testBrowser]: (browserPath: string) => Promise<BrowserTestResult>
  [IPC_CHANNELS.chrome.toggleDevTools]: () => void
  [IPC_CHANNELS.chrome.setPath]: (path: string) => void
  [IPC_CHANNELS.chrome.saveState]: (accountId: string, state: string) => void

  // App
  [IPC_CHANNELS.app.openLogFolder]: () => void
  [IPC_CHANNELS.app.openExternal]: (url: string) => void
  [IPC_CHANNELS.app.notifyUpdate]: (arg: {
    currentVersion: string
    latestVersion: string
    releaseNote?: string
  }) => void
  [IPC_CHANNELS.app.hideToTrayTip]: (arg: Record<string, never>) => void
  [IPC_CHANNELS.app.setHideToTrayTipDismissed]: (dismissed: boolean) => Promise<void>
  [IPC_CHANNELS.app.getHideToTrayTipDismissed]: () => Promise<boolean>
  [IPC_CHANNELS.app.clearLocalLoginData]: () => Promise<void>

  [IPC_CHANNELS.account.switch]: (params: { account: Account }) => void

  // Log
  [IPC_CHANNELS.log]: (message: LogMessage) => void

  // LiveStats
  [IPC_CHANNELS.liveStats.exportData]: (payload: {
    data: {
      accountName: string
      startTime: number | null
      endTime: number
      duration: number
      stats: {
        likeCount: number
        commentCount: number
        enterCount: number
        followCount: number
        fansClubCount: number
        orderCount: number
        paidOrderCount: number
        brandVipCount: number
      }
      danmuList: Array<{
        nickName: string
        content: string
        time: string
      }>
      fansClubChanges: Array<{
        id: string
        nickName: string
        userId?: string
        content?: string
        time: string
      }>
      events: Array<{
        id: string
        type: string
        nickName: string
        content?: string
        time: string
        extra?: Record<string, unknown>
      }>
    }
    format?: 'csv' | 'excel'
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  [IPC_CHANNELS.liveStats.openExportFolder]: () => void
}

export type IpcRendererInvokeReturnType<Channel extends keyof IpcChannels> =
  ReturnType<IpcChannels[Channel]> extends Promise<infer _U>
    ? ReturnType<IpcChannels[Channel]>
    : Promise<ReturnType<IpcChannels[Channel]>>

export type IpcInvoke = <Channel extends keyof IpcChannels>(
  channel: Channel,
  ...args: Parameters<IpcChannels[Channel]>
) => IpcRendererInvokeReturnType<Channel>

export interface ElectronAPI {
  ipcRenderer: {
    invoke: IpcInvoke

    send: <Channel extends keyof IpcChannels>(
      channel: Channel,
      ...args: Parameters<IpcChannels[Channel]>
    ) => void

    on: <Channel extends keyof IpcChannels>(
      channel: Channel,
      listener: (...args: Parameters<IpcChannels[Channel]>) => void,
    ) => () => void
  }
}

// 为需要动态 channel 的场景提供宽松类型（如 TaskContext.ipcInvoke）
export interface LooseElectronAPI {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  }
}
