import { app, BrowserWindow, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { accountManager } from '#/managers/AccountManager'
import { typedIpcMainHandle } from '#/utils'

let cloudAuthStoragePromise: Promise<typeof import('#/services/CloudAuthStorage')> | null = null

async function clearCloudStoredTokens() {
  if (!cloudAuthStoragePromise) {
    cloudAuthStoragePromise = import('#/services/CloudAuthStorage')
  }
  ;(await cloudAuthStoragePromise).clearStoredTokens()
}

function setupIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.chrome.toggleDevTools, event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openLogFolder, () => {
    shell.openPath(app.getPath('logs'))
  })

  typedIpcMainHandle(IPC_CHANNELS.app.openExternal, (_, url: string) => {
    // 验证 URL 格式，只允许常规网页与邮件协议
    const allowedProtocols = ['http:', 'https:', 'mailto:']
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error('Invalid URL format')
    }
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      throw new Error(
        `Protocol "${parsedUrl.protocol}" is not allowed. Only HTTP, HTTPS, and mailto are supported.`,
      )
    }
    shell.openExternal(url)
  })

  typedIpcMainHandle(IPC_CHANNELS.account.switch, (_, { account }) => {
    accountManager.setAccountName(account.id, account.name)
    accountManager.wakeIdleSession(account.id, 'account-switch')
  })

  /** 清除本地登录数据：主进程 token 存储（userData/auth/tokens.enc），渲染进程需自行清除 localStorage 与 store */
  typedIpcMainHandle(IPC_CHANNELS.app.clearLocalLoginData, async () => {
    await clearCloudStoredTokens()
  })
}

export function setupAppIpcHandlers() {
  setupIpcHandlers()
}
