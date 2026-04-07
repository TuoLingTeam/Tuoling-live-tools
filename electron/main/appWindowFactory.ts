import { existsSync } from 'node:fs'
import path from 'node:path'
import { type App, BrowserWindow } from 'electron'

type LogFns = {
  debugStartupLog: (message: string) => void
  writeStartupLog: (message: string) => void
}

export function createAppMainWindow(params: {
  app: App
  preloadPath: string
  viteDevServerUrl?: string
  vitePublicPath: string
  logs: LogFns
}) {
  const { app, preloadPath, viteDevServerUrl, vitePublicPath, logs } = params
  const isDev = !!viteDevServerUrl

  logs.debugStartupLog(`VITE_DEV_SERVER_URL: ${viteDevServerUrl || 'N/A'}`)
  logs.debugStartupLog(`isDev: ${isDev}`)
  logs.debugStartupLog(`preload 路径: ${preloadPath}`)
  logs.debugStartupLog(`preload 存在: ${existsSync(preloadPath)}`)

  const isWindowsPackaged = app.isPackaged && process.platform === 'win32'
  const isDevMode = isDev || !app.isPackaged
  const showOnStart = isDevMode || isWindowsPackaged

  logs.debugStartupLog(
    `[窗口显示规则] isWindowsPackaged=${isWindowsPackaged}, isDevMode=${isDevMode}, showOnStart=${showOnStart}`,
  )

  const iconPath = path.join(vitePublicPath, 'favicon.png')
  logs.debugStartupLog(`图标路径: ${iconPath}`)
  logs.debugStartupLog(`图标存在: ${existsSync(iconPath)}`)

  const win = new BrowserWindow({
    title: `秀儿直播助手 - v${app.getVersion()}`,
    width: 1280,
    height: 800,
    x: showOnStart ? 80 : undefined,
    y: showOnStart ? 60 : undefined,
    show: showOnStart,
    autoHideMenuBar: app.isPackaged,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: app.isPackaged,
    },
  })

  return {
    win,
    showOnStart,
  }
}
