import type { IpcInvoke, LooseElectronAPI } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'

type LegacyIpcRenderer = LooseElectronAPI['ipcRenderer'] & {
  off?: (channel: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void
}

function getLegacyIpcRenderer(): LegacyIpcRenderer | undefined {
  const candidate = (window as Window & { ipcRenderer?: LegacyIpcRenderer }).ipcRenderer
  return candidate && typeof candidate.invoke === 'function' ? candidate : undefined
}

function requireLegacyIpcRenderer(): LegacyIpcRenderer {
  const ipcRenderer = getLegacyIpcRenderer()
  if (!ipcRenderer) {
    throw new Error('任务 IPC 不可用')
  }
  return ipcRenderer
}

function subscribeWithFallback(channel: string, callback: (accountId: string) => void): () => void {
  const ipcRenderer = getLegacyIpcRenderer()
  if (!ipcRenderer?.on) {
    return () => {}
  }

  const listener = (...args: unknown[]) => {
    const maybeAccountId =
      typeof args[1] === 'string' ? args[1] : typeof args[0] === 'string' ? args[0] : undefined
    if (typeof maybeAccountId === 'string') {
      callback(maybeAccountId)
    }
  }

  const unsubscribe = ipcRenderer.on(channel, listener)
  if (typeof unsubscribe === 'function') {
    return unsubscribe
  }

  return () => {
    if (typeof ipcRenderer.off === 'function') {
      ipcRenderer.off(channel, listener)
      return
    }
    if (typeof ipcRenderer.removeListener === 'function') {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

export function getTaskIPCInvoke(): IpcInvoke {
  if (window.taskIPC?.invoke) {
    return window.taskIPC.invoke
  }

  const ipcRenderer = requireLegacyIpcRenderer()
  return ((channel, ...args) => ipcRenderer.invoke(channel as string, ...args)) as IpcInvoke
}

export function onAutoMessageStopped(
  accountId: string,
  callback: (id: string) => void,
): () => void {
  if (window.taskEventsAPI?.onAutoMessageStopped) {
    return window.taskEventsAPI.onAutoMessageStopped(accountId, callback)
  }
  return subscribeWithFallback(IPC_CHANNELS.tasks.autoMessage.stoppedFor(accountId), callback)
}

export function onAutoPopUpStopped(accountId: string, callback: (id: string) => void): () => void {
  if (window.taskEventsAPI?.onAutoPopUpStopped) {
    return window.taskEventsAPI.onAutoPopUpStopped(accountId, callback)
  }
  return subscribeWithFallback(IPC_CHANNELS.tasks.autoPopUp.stoppedFor(accountId), callback)
}

export function onCommentListenerStopped(
  accountId: string,
  callback: (id: string) => void,
): () => void {
  if (window.taskEventsAPI?.onCommentListenerStopped) {
    return window.taskEventsAPI.onCommentListenerStopped(accountId, callback)
  }
  return subscribeWithFallback(IPC_CHANNELS.tasks.commentListener.stoppedFor(accountId), callback)
}

export async function stopCommentListener(accountId: string): Promise<unknown> {
  if (window.taskControlAPI?.stopCommentListener) {
    return await window.taskControlAPI.stopCommentListener(accountId)
  }
  return await requireLegacyIpcRenderer().invoke(IPC_CHANNELS.tasks.commentListener.stop, accountId)
}

export async function stopAutoMessage(accountId: string): Promise<unknown> {
  if (window.taskControlAPI?.stopAutoMessage) {
    return await window.taskControlAPI.stopAutoMessage(accountId)
  }
  return await requireLegacyIpcRenderer().invoke(IPC_CHANNELS.tasks.autoMessage.stop, accountId)
}

export async function stopAutoPopUp(accountId: string): Promise<unknown> {
  if (window.taskControlAPI?.stopAutoPopUp) {
    return await window.taskControlAPI.stopAutoPopUp(accountId)
  }
  return await requireLegacyIpcRenderer().invoke(IPC_CHANNELS.tasks.autoPopUp.stop, accountId)
}

export async function stopSubAccount(accountId: string): Promise<unknown> {
  if (window.taskControlAPI?.stopSubAccount) {
    return await window.taskControlAPI.stopSubAccount(accountId)
  }
  return await requireLegacyIpcRenderer().invoke(IPC_CHANNELS.tasks.subAccount.stop, accountId)
}

export async function disconnectLiveControl(accountId: string): Promise<unknown> {
  if (window.liveControlAPI?.disconnect) {
    return await window.liveControlAPI.disconnect(accountId)
  }
  return await requireLegacyIpcRenderer().invoke(
    IPC_CHANNELS.tasks.liveControl.disconnect,
    accountId,
  )
}
