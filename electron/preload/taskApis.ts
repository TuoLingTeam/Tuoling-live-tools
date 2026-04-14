import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvoke } from 'shared/electron-api'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

export const autoReplyAPI = {
  sendReply: async (accountId: string, message: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoReply.sendReply, accountId, message)
  },

  exportData: async (payload: { data: unknown; format?: 'csv' | 'json' }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoReply.exportData, payload)
  },

  openExportFolder: async () => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoReply.openExportFolder)
  },

  pinComment: async (params: { accountId: string; content: string }) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.pinComment, params)
  },
}

export const autoPopUpAPI = {
  fetchGoodsIds: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoPopUp.fetchGoodsIds, accountId)
  },

  scanGoodsKnowledge: async (accountId: string, goodsId: number) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.autoPopUp.scanGoodsKnowledge,
      accountId,
      goodsId,
    )
  },

  updateConfig: async (accountId: string, config: Partial<AutoPopupConfig>) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoPopUp.updateConfig, accountId, config)
  },

  registerShortcuts: async (
    accountId: string,
    shortcuts: Array<{ accelerator: string; goodsIds: number[] }>,
  ) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.autoPopUp.registerShortcuts,
      accountId,
      shortcuts,
    )
  },

  unregisterShortcuts: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoPopUp.unregisterShortcuts, accountId)
  },
}

export const autoMessageAPI = {
  sendBatchMessages: async (accountId: string, messages: string[], count: number) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.autoMessage.sendBatchMessages,
      accountId,
      messages,
      count,
    )
  },
}

export const taskControlAPI = {
  stopCommentListener: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.commentListener.stop, accountId)
  },

  stopAutoMessage: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoMessage.stop, accountId)
  },

  stopAutoPopUp: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.autoPopUp.stop, accountId)
  },

  stopSubAccount: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.stop, accountId)
  },
}

export const diagnosticsAPI = {
  getAccountTasks: async (accountId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.diagnostics.getAccountTasks, accountId)
  },
}

export const taskEventsAPI = {
  onAutoMessageStopped: (accountId: string, callback: (id: string) => void) => {
    const channel = IPC_CHANNELS.tasks.autoMessage.stoppedFor(accountId)
    const listener = (_event: unknown, id: string) => callback(id)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },

  onAutoPopUpStopped: (accountId: string, callback: (id: string) => void) => {
    const channel = IPC_CHANNELS.tasks.autoPopUp.stoppedFor(accountId)
    const listener = (_event: unknown, id: string) => callback(id)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },

  onCommentListenerStopped: (accountId: string, callback: (id: string) => void) => {
    const channel = IPC_CHANNELS.tasks.commentListener.stoppedFor(accountId)
    const listener = (_event: unknown, id: string) => callback(id)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },
}

export const taskIPC = {
  invoke: ((channel, ...args) => ipcRenderer.invoke(channel as string, ...args)) as IpcInvoke,
}

contextBridge.exposeInMainWorld('autoReplyAPI', autoReplyAPI)
contextBridge.exposeInMainWorld('autoPopUpAPI', autoPopUpAPI)
contextBridge.exposeInMainWorld('autoMessageAPI', autoMessageAPI)
contextBridge.exposeInMainWorld('taskControlAPI', taskControlAPI)
contextBridge.exposeInMainWorld('diagnosticsAPI', diagnosticsAPI)
contextBridge.exposeInMainWorld('taskEventsAPI', taskEventsAPI)
contextBridge.exposeInMainWorld('taskIPC', taskIPC)
