import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

export const updateAPI = {
  getStatus: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.getStatus)
  },
  checkUpdate: async (source?: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.checkUpdate, source)
  },
  startDownload: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.startDownload)
  },
  quitAndInstall: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.quitAndInstall)
  },
  rollback: async (targetVersion?: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.rollback, targetVersion)
  },
  listBackups: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.updater.listBackups)
  },
}

export const appAPI = {
  openLogFolder: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.app.openLogFolder)
  },
  openExternal: async (url: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, url)
  },
  clearLocalLoginData: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.app.clearLocalLoginData)
  },
  getHideToTrayTipDismissed: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.app.getHideToTrayTipDismissed)
  },
  setHideToTrayTipDismissed: async (dismissed: boolean) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.app.setHideToTrayTipDismissed, dismissed)
  },
}

export const chromeAPI = {
  listBrowsers: async (preferEdge = false) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.chrome.listBrowsers, preferEdge)
  },
  selectPath: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.chrome.selectPath)
  },
  testBrowser: async (browserPath: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.chrome.testBrowser, browserPath)
  },
  toggleDevTools: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.chrome.toggleDevTools)
  },
}

export const liveControlAPI = {
  connect: async (params: {
    browserPath?: string
    headless?: boolean
    storageState?: string
    platform: LiveControlPlatform
    account: Account
    traceId?: string
  }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.connect, params)
  },
  disconnect: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, accountId)
  },
  getLiveRoomUrl: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.getLiveRoomUrl, accountId)
  },
}

export const accountAPI = {
  switchAccount: async (account: { id: string; name: string }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.account.switch, { account })
  },
}

export const liveStatsAPI = {
  exportData: async (payload: { data: unknown; format?: 'csv' | 'excel' }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.liveStats.exportData, payload)
  },

  openExportFolder: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.liveStats.openExportFolder)
  },
}

contextBridge.exposeInMainWorld('updateAPI', updateAPI)
contextBridge.exposeInMainWorld('appAPI', appAPI)
contextBridge.exposeInMainWorld('chromeAPI', chromeAPI)
contextBridge.exposeInMainWorld('liveControlAPI', liveControlAPI)
contextBridge.exposeInMainWorld('accountAPI', accountAPI)
contextBridge.exposeInMainWorld('liveStatsAPI', liveStatsAPI)
