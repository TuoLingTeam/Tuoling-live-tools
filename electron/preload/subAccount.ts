import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

export const subAccountAPI = {
  getAllAccounts: async (workspaceId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.getAllAccounts, workspaceId)
  },

  addAccount: async (
    workspaceId: string,
    account: { id: string; name: string; platform: LiveControlPlatform },
  ) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.addAccount, workspaceId, account)
  },

  removeAccount: async (workspaceId: string, accountId: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.removeAccount,
      workspaceId,
      accountId,
    )
  },

  loginAccount: async (workspaceId: string, accountId: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.loginAccount,
      workspaceId,
      accountId,
    )
  },

  disconnectAccount: async (workspaceId: string, accountId: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.disconnectAccount,
      workspaceId,
      accountId,
    )
  },

  clearStorageState: async (workspaceId: string, accountId: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.clearStorageState,
      workspaceId,
      accountId,
    )
  },

  exportAccounts: async (workspaceId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.exportAccounts, workspaceId)
  },

  importAccounts: async (workspaceId: string, jsonData: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.importAccounts,
      workspaceId,
      jsonData,
    )
  },

  syncAccounts: async (
    workspaceId: string,
    accountConfigs: Array<{ id: string; name: string; platform: LiveControlPlatform }>,
  ) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.syncAccounts,
      workspaceId,
      accountConfigs,
    )
  },

  start: async (workspaceId: string, config: SubAccountInteractionConfig) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.start, workspaceId, config)
  },

  stop: async (workspaceId: string) => {
    return await ipcRenderer.invoke(IPC_CHANNELS.tasks.subAccount.stop, workspaceId)
  },

  enterLiveRoom: async (workspaceId: string, accountId: string, liveRoomUrl: string) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.enterLiveRoom,
      workspaceId,
      accountId,
      liveRoomUrl,
    )
  },

  enterAllLiveRooms: async (workspaceId: string, liveRoomUrl: string, accountIds: string[]) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.enterAllLiveRooms,
      workspaceId,
      liveRoomUrl,
      accountIds,
    )
  },

  sendBatch: async (
    workspaceId: string,
    count: number,
    messages?: { content: string; weight?: number }[],
  ) => {
    return await ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.sendBatch,
      workspaceId,
      count,
      messages,
    )
  },
}

contextBridge.exposeInMainWorld('subAccountAPI', subAccountAPI)
