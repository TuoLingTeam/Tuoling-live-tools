// =====================================================
// Auto-generated IPC Channel Whitelist
// DO NOT EDIT MANUALLY - This file is auto-generated from shared/ipcChannels.ts
// Run 'npx tsx scripts/generateIpcWhitelist.ts' to regenerate
// =====================================================

// 静态通道白名单
const ALLOWED_STATIC_CHANNELS: string[] = [
  'account:switch',
  'app:clearLocalLoginData',
  'app:getHideToTrayTipDismissed',
  'app:hideToTrayTip',
  'app:notifyUpdate',
  'app:openExternal',
  'app:openLogFolder',
  'app:setHideToTrayTipDismissed',
  'auth:checkFeatureAccess',
  'auth:clearTokens',
  'auth:getAuthSummary',
  'auth:getCurrentUser',
  'auth:login',
  'auth:loginRequired',
  'auth:loginWithSms',
  'auth:logout',
  'auth:messageStreamSnapshot',
  'auth:messageStreamState',
  'auth:proxyRequest',
  'auth:refreshSession',
  'auth:register',
  'auth:restoreSession',
  'auth:startMessageStream',
  'auth:stateChanged',
  'auth:stopMessageStream',
  'auth:validateToken',
  'chrome:getPath',
  'chrome:listBrowsers',
  'chrome:saveState',
  'chrome:selectPath',
  'chrome:setPath',
  'chrome:testBrowser',
  'chrome:toggleDevTools',
  'config:load',
  'config:save',
  'diagnostics:getAccountTasks',
  'diagnostics:getRuntimeStats',
  'diagnostics:getTimeline',
  'diagnostics:printSummary',
  'diagnostics:reset',
  'liveStats:exportData',
  'liveStats:openExportFolder',
  'log',
  'tasks:aiChat:chat',
  'tasks:aiChat:clearStoredApiKeys',
  'tasks:aiChat:error',
  'tasks:aiChat:getStoredApiKeys',
  'tasks:aiChat:normalChat',
  'tasks:aiChat:setStoredApiKeys',
  'tasks:aiChat:stream',
  'tasks:aiChat:testApiKey',
  'tasks:autoMessage:sendBatchMessages',
  'tasks:autoMessage:start',
  'tasks:autoMessage:stop',
  'tasks:autoMessage:updateConfig',
  'tasks:autoPopUp:fetchGoodsIds',
  'tasks:autoPopUp:scanGoodsKnowledge',
  'tasks:autoPopUp:start',
  'tasks:autoPopUp:stop',
  'tasks:autoPopUp:updateConfig',
  'tasks:autoPopup:registerShortcut',
  'tasks:autoPopup:unregisterShortcut',
  'tasks:autoReply:exportData',
  'tasks:autoReply:openExportFolder',
  'tasks:autoReply:replyGenerated',
  'tasks:autoReply:sendReply',
  'tasks:autoReply:startAutoReply',
  'tasks:autoReply:stopAutoReply',
  'tasks:commentListener:showComment',
  'tasks:commentListener:start',
  'tasks:commentListener:stop',
  'tasks:liveControl:connect',
  'tasks:liveControl:disconnect',
  'tasks:liveControl:disconnectedEvent',
  'tasks:liveControl:getLiveRoomUrl',
  'tasks:liveControl:notifyAccountName',
  'tasks:liveControl:reconnectFailedEvent',
  'tasks:liveControl:reconnectedEvent',
  'tasks:liveControl:setAutoStartOnLive',
  'tasks:liveControl:stateChanged',
  'tasks:liveControl:streamStateChanged',
  'tasks:liveControl:waitingForLogin',
  'tasks:pinComment',
  'tasks:subAccount:accountStatusChanged',
  'tasks:subAccount:addAccount',
  'tasks:subAccount:batchProgress',
  'tasks:subAccount:checkHealth',
  'tasks:subAccount:clearStorageState',
  'tasks:subAccount:disconnectAccount',
  'tasks:subAccount:enterAllLiveRooms',
  'tasks:subAccount:enterAllProgress',
  'tasks:subAccount:enterLiveRoom',
  'tasks:subAccount:exportAccounts',
  'tasks:subAccount:getAllAccounts',
  'tasks:subAccount:importAccounts',
  'tasks:subAccount:loginAccount',
  'tasks:subAccount:removeAccount',
  'tasks:subAccount:sendBatch',
  'tasks:subAccount:start',
  'tasks:subAccount:stop',
  'tasks:subAccount:syncAccounts',
  'tasks:subAccount:updateConfig',
  'updater:checkUpdate',
  'updater:downloadProgress',
  'updater:getStatus',
  'updater:listBackups',
  'updater:quitAndInstall',
  'updater:rollback',
  'updater:startDownload',
  'updater:updateAvailable',
  'updater:updateDownloaded',
  'updater:updateError',
]

// 动态通道前缀（用于账号隔离事件，如 tasks:autoMessage:stopped:{accountId}）
const ALLOWED_DYNAMIC_PREFIXES: string[] = [
  'tasks:autoMessage:stopped:',
  'tasks:autoPopUp:stopped:',
  'tasks:commentListener:stopped:',
  'tasks:subAccount:stopped:',
]

/**
 * 检查通道是否允许
 * 支持静态通道精确匹配和动态通道前缀匹配
 */
export function isChannelAllowed(channel: string): boolean {
  // 先检查静态通道
  if (ALLOWED_STATIC_CHANNELS.includes(channel)) {
    return true
  }

  // 再检查动态通道前缀
  for (const prefix of ALLOWED_DYNAMIC_PREFIXES) {
    if (channel.startsWith(prefix)) {
      return true
    }
  }

  return false
}

/**
 * 获取所有允许的通道（用于调试和校验）
 */
export function getAllAllowedChannels(): string[] {
  return [...ALLOWED_STATIC_CHANNELS]
}

/**
 * 开发环境警告：未允许的通道
 */
export function warnIfNotAllowed(channel: string): void {
  if (!isChannelAllowed(channel)) {
    console.warn(`[Preload] Channel not in whitelist: ${channel}`)
  }
}
