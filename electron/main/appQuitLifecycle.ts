import type { App, BrowserWindow, Tray } from 'electron'
import {
  cleanupAccounts,
  cleanupWindowReference,
  closeWindowForQuit,
  destroyTrayResource,
} from './appCleanup'

type LogFns = {
  writeStartupLog: (message: string) => void
  writeMainLog: (level: string, message: string) => void
}

export function handleWindowAllClosed(params: {
  platform: NodeJS.Platform
  isQuitting: boolean
  writeStartupLog: (message: string) => void
}) {
  const { platform, isQuitting, writeStartupLog } = params

  writeStartupLog(`事件: window-all-closed 触发 - platform=${platform}, isQuitting=${isQuitting}`)
  writeStartupLog('窗口全部关闭，应用保持运行（托盘模式）')
}

export function handleBeforeQuit(params: {
  isQuitting: boolean
  markQuitting: () => void
  stopMemoryLogInterval: () => void
  cleanupAccountManager: () => void
  logs: LogFns
}) {
  const { isQuitting, markQuitting, stopMemoryLogInterval, cleanupAccountManager, logs } = params

  logs.writeStartupLog(`事件: before-quit 触发 - isQuitting=${isQuitting}`)
  if (isQuitting) {
    return
  }

  markQuitting()
  stopMemoryLogInterval()
  cleanupAccounts(cleanupAccountManager, logs)
}

export function handleWillQuit(params: {
  tray: Tray | null
  win: BrowserWindow | null
  logs: LogFns
}) {
  const { tray, win, logs } = params

  logs.writeStartupLog('事件: will-quit 触发')
  logs.writeMainLog('INFO', '应用即将退出，执行最终清理...')

  return {
    tray: destroyTrayResource(tray, logs),
    win: cleanupWindowReference(win, logs),
  }
}

export function quitElectronApp(params: {
  app: App
  isQuitting: boolean
  markQuitting: () => void
  stopMemoryLogInterval: () => void
  cleanupAccountManager: () => void
  tray: Tray | null
  win: BrowserWindow | null
  logs: LogFns
}) {
  const {
    app,
    isQuitting,
    markQuitting,
    stopMemoryLogInterval,
    cleanupAccountManager,
    tray,
    win,
    logs,
  } = params

  logs.writeStartupLog(`quitApp 调用 - isQuitting=${isQuitting}`)
  if (isQuitting) {
    return { tray, win }
  }

  logs.writeMainLog('INFO', '开始退出应用...')
  markQuitting()
  stopMemoryLogInterval()
  cleanupAccounts(cleanupAccountManager, logs)

  const nextTray = destroyTrayResource(tray, logs)
  const nextWin = closeWindowForQuit(win, logs)

  logs.writeStartupLog('调用 app.quit()')
  app.quit()

  return {
    tray: nextTray,
    win: nextWin,
  }
}
