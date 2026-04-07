import { existsSync } from 'node:fs'
import path from 'node:path'
import { type App, type BrowserWindow, nativeImage } from 'electron'

type ReadyLogFns = {
  debugStartupLog: (message: string) => void
  logStartupInfo: () => void
  logWindowDebug: (phase: string, windowRef: BrowserWindow | null) => void
  writeStartupLog: (message: string) => void
}

type InstanceLogFns = {
  writeMainLog: (level: string, message: string) => void
  writeStartupLog: (message: string) => void
}

export function handleSecondInstance(params: {
  commandLine: string[]
  mainWindow: BrowserWindow | null
  createWindow: () => void
  logs: InstanceLogFns
}) {
  const { commandLine, mainWindow, createWindow, logs } = params

  logs.writeStartupLog(`second-instance 触发，命令行: ${commandLine.join(' ')}`)
  logs.writeMainLog('INFO', 'second-instance: 检测到第二个实例启动，唤醒主窗口')

  if (mainWindow && !mainWindow.isDestroyed()) {
    logs.writeStartupLog('second-instance: 主窗口存在，准备显示')

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
      logs.writeStartupLog('second-instance: 窗口已从最小化恢复')
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show()
      logs.writeStartupLog('second-instance: 窗口已从隐藏状态显示')
    }

    mainWindow.setSkipTaskbar(false)
    mainWindow.focus()
    mainWindow.moveTop()

    const result = {
      visible: mainWindow.isVisible(),
      minimized: mainWindow.isMinimized(),
      focused: mainWindow.isFocused(),
    }
    logs.writeStartupLog(`second-instance: 主窗口唤醒结果: ${JSON.stringify(result)}`)
    logs.writeMainLog(
      'INFO',
      `second-instance: 窗口唤醒成功 - visible=${result.visible}, minimized=${result.minimized}`,
    )
    return
  }

  logs.writeStartupLog('second-instance: 主窗口不存在，创建新窗口')
  logs.writeMainLog('WARN', 'second-instance: mainWindow not created yet, creating new window')
  createWindow()
}

export function handleAppReady(params: {
  app: App
  vitePublicPath: string
  getMainWindow: () => BrowserWindow | null
  createWindow: () => void
  createTray: () => void
  startMemoryLogInterval: () => void
  logs: ReadyLogFns
}) {
  const {
    app,
    vitePublicPath,
    getMainWindow,
    createWindow,
    createTray,
    startMemoryLogInterval,
    logs,
  } = params

  logs.writeStartupLog('========== app.whenReady 触发 ==========')
  logs.logStartupInfo()
  logs.logWindowDebug('after whenReady', getMainWindow())

  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIconPath = path.join(vitePublicPath, 'icon.png')
    if (existsSync(dockIconPath) && app.dock) {
      try {
        const dockIcon = nativeImage.createFromPath(dockIconPath)
        app.dock.setIcon(dockIcon)
        logs.debugStartupLog('Dock 图标已设置')
      } catch (error) {
        logs.debugStartupLog(`设置 Dock 图标失败: ${error}`)
      }
    }
  }

  logs.writeStartupLog('开始创建窗口')
  createWindow()

  logs.debugStartupLog('开始创建托盘')
  createTray()

  logs.debugStartupLog('启动内存日志')
  startMemoryLogInterval()

  logs.writeStartupLog('========== 应用启动完成 ==========')
}

export function handleAppActivate(params: {
  allWindows: BrowserWindow[]
  createWindow: () => void
  writeStartupLog: (message: string) => void
}) {
  const { allWindows, createWindow, writeStartupLog } = params

  writeStartupLog('事件: activate 触发')
  writeStartupLog(`activate: 现有窗口数=${allWindows.length}`)

  if (allWindows.length) {
    const mainWindow = allWindows[0]
    if (!mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      writeStartupLog('activate: 聚焦现有窗口')
    }
    return
  }

  writeStartupLog('activate: 无窗口，创建新窗口')
  createWindow()
}
