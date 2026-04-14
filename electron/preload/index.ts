import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { ElectronAPI, IpcChannels } from 'shared/electron-api'
import './aichat'
import { isChannelAllowed } from './ipcWhitelist.gen'
import './subAccount'
import './systemApis'
import './taskApis'
import './auth'

type IpcRendererInvokeReturnType<Channel extends keyof IpcChannels> =
  ReturnType<IpcChannels[Channel]> extends Promise<infer _U>
    ? ReturnType<IpcChannels[Channel]>
    : Promise<ReturnType<IpcChannels[Channel]>>

// IPC 通道白名单已迁移到 ipcWhitelist.gen.ts
// 由 scripts/generateIpcWhitelist.ts 从 shared/ipcChannels.ts 自动生成

const ipcRendererApi: ElectronAPI['ipcRenderer'] = {
  on<Channel extends keyof IpcChannels>(
    channel: Channel,
    listener: (...args: Parameters<IpcChannels[Channel]>) => void,
  ): () => void {
    // 只允许白名单内的通道
    if (!isChannelAllowed(channel as string)) {
      console.warn(
        `[Preload][on] ❌ Channel ${channel} is NOT in whitelist, listener NOT registered`,
      )
      return () => {}
    }

    const subscription = (_event: IpcRendererEvent, ...args: Parameters<IpcChannels[Channel]>) => {
      const receiveTime = Date.now()
      const accountId = args[0] || 'unknown'
      // 通过自定义事件通知 renderer 记录时间
      window.dispatchEvent(
        new CustomEvent('ipc-receive', {
          detail: { channel: String(channel), accountId, receiveTime },
        }),
      )
      listener(...args)
    }

    ipcRenderer.on(channel as string, subscription)
    return () => {
      ipcRenderer.off(channel as string, subscription)
    }
  },

  send: <Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): void => {
    // 只允许白名单内的通道
    if (!isChannelAllowed(channel as string)) {
      console.warn(`[Preload] Channel ${channel} is not allowed for send()`)
      return
    }
    ipcRenderer.send(channel as string, ...args)
  },

  invoke: <Channel extends keyof IpcChannels>(
    channel: Channel,
    ...args: Parameters<IpcChannels[Channel]>
  ): IpcRendererInvokeReturnType<Channel> => {
    // 只允许白名单内的通道
    if (!isChannelAllowed(channel as string)) {
      console.warn(`[Preload] Channel ${channel} is not allowed for invoke()`)
      return Promise.reject(
        new Error(`Channel ${channel} is not allowed`),
      ) as IpcRendererInvokeReturnType<Channel>
    }
    return ipcRenderer.invoke(channel as string, ...args) as IpcRendererInvokeReturnType<Channel>
  },
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', ipcRendererApi)

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = 'loaders-css__square-spin'
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

// biome-ignore lint/correctness/useHookAtTopLevel: 这不是 hook
const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = ev => {
  if (ev.source !== window) {
    return
  }

  const payload =
    ev.data && typeof ev.data === 'object' && 'payload' in ev.data ? ev.data.payload : undefined
  if (payload === 'removeLoading') {
    removeLoading()
  }
}

setTimeout(removeLoading, 4999)
