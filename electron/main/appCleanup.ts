import type { BrowserWindow, Tray } from 'electron'

type Logs = {
  writeStartupLog: (message: string) => void
  writeMainLog: (level: string, message: string) => void
}

export function cleanupAccounts(cleanup: () => void, logs: Logs) {
  try {
    cleanup()
    logs.writeStartupLog('账户管理器已清理')
  } catch (error) {
    logs.writeMainLog('ERROR', `清理账户管理器失败: ${error}`)
  }
}

export function destroyTrayResource(tray: Tray | null, logs: Logs): Tray | null {
  if (!tray) return tray

  try {
    tray.destroy()
    logs.writeStartupLog('托盘已销毁')
    return null
  } catch (error) {
    logs.writeMainLog('ERROR', `销毁托盘失败: ${error}`)
    return tray
  }
}

export function cleanupWindowReference(
  win: BrowserWindow | null,
  logs: Logs,
): BrowserWindow | null {
  if (!win) return win

  try {
    win.removeAllListeners()
    logs.writeStartupLog('窗口已清理')
    return null
  } catch (error) {
    logs.writeMainLog('ERROR', `清理窗口失败: ${error}`)
    return win
  }
}

export function closeWindowForQuit(win: BrowserWindow | null, logs: Logs): BrowserWindow | null {
  if (!win || win.isDestroyed()) return win

  try {
    win.removeAllListeners()
    win.close()
    logs.writeStartupLog('窗口已关闭')
    return null
  } catch (error) {
    logs.writeMainLog('ERROR', `关闭窗口失败: ${error}`)
    return win
  }
}
