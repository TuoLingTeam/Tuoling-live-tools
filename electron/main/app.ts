/**
 * 秀儿直播助手
 * Copyright (c) 2025-2026 秀儿直播助手团队
 * Copyright (c) 2024-2025 qiutongxue (original project: oba-live-tool)
 * Licensed under the MIT License
 */

import os from 'node:os'
import process from 'node:process'
import { app, BrowserWindow, dialog, type Tray } from 'electron'
import { registerAppConfigIpc } from './appConfigIpc'
import { handleAppActivate, handleAppReady, handleSecondInstance } from './appLifecycle'
import { createAppMemoryLogger } from './appMemoryLogger'
import { type AppPathResolution, resolveAppPaths } from './appPaths'
import { registerAppProcessHandlers } from './appProcessHandlers'
import {
  handleBeforeQuit,
  handleWillQuit,
  handleWindowAllClosed,
  quitElectronApp,
} from './appQuitLifecycle'
import { createAppTray } from './appTray'
import {
  registerMainWindowCloseBehavior,
  registerMainWindowLifecycleEvents,
  registerMainWindowWebContentsEvents,
} from './appWindowEvents'
import { createAppMainWindow } from './appWindowFactory'
import { loadMainWindowContent } from './appWindowLoader'
import { accountManager } from './managers/AccountManager'
import { enhancedUpdateManager } from './managers/EnhancedUpdateManager'
import { subAccountManager } from './managers/SubAccountManager'
import { subAccountTaskManager } from './managers/SubAccountTaskManager'
import windowManager from './windowManager'
import './ipc'
import { createAppConfigStore } from './appConfigStore'
import { createAppStartupLogging } from './appStartupLogging'
import { setAppQuitting } from './logger'

const {
  STARTUP_DEBUG,
  buildRendererErrorScript,
  debugStartupLog,
  logStartupInfo,
  logWindowDebug,
  writeCrashToTemp,
  writeMainLog,
  writeStartupLog,
} = createAppStartupLogging(app)

const { getConfig, setConfig } = createAppConfigStore(app)
const { startMemoryLogInterval, stopMemoryLogInterval } = createAppMemoryLogger(
  () => accountManager.accountSessions.size,
)

writeStartupLog('========== 应用启动 ==========')
writeStartupLog(
  `pid=${process.pid} electron=${process.versions.electron} node=${process.versions.node} platform=${process.platform}/${process.arch} packaged=${app.isPackaged}`,
)
debugStartupLog(`应用路径: ${app.getAppPath()}`)
debugStartupLog(`用户数据目录: ${app.getPath('userData')}`)
debugStartupLog(`资源目录: ${process.resourcesPath || 'N/A'}`)
debugStartupLog(`当前工作目录: ${process.cwd()}`)
debugStartupLog(`命令行参数: ${process.argv.join(' ')}`)

const {
  viteDevServerUrl: VITE_DEV_SERVER_URL,
  preloadPath: preload,
  indexHtmlPath: indexHtml,
}: AppPathResolution = resolveAppPaths({
  app,
  startupDebug: STARTUP_DEBUG,
  logs: {
    debugStartupLog,
    writeStartupLog,
  },
})

// 仅在开发模式下启用远程调试端口
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// Windows 7 禁用 GPU 加速
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Windows 10+ 通知设置
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// ==================== 单实例锁 ====================
const gotTheLock = app.requestSingleInstanceLock()
writeStartupLog(`单实例锁获取结果: ${gotTheLock}`)

if (!gotTheLock) {
  writeStartupLog('未能获取单实例锁，退出应用')
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, commandLine, _workingDirectory) => {
  handleSecondInstance({
    commandLine,
    mainWindow: win,
    createWindow: () => {
      void createWindow()
    },
    logs: {
      writeMainLog,
      writeStartupLog,
    },
  })
})

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

async function cleanupRuntimeManagers(): Promise<void> {
  subAccountTaskManager.cleanup()
  await subAccountManager.cleanup().catch(error => {
    writeMainLog('ERROR', `sub-account cleanup failed: ${error}`)
  })
  await accountManager.cleanup()
}

async function createWindow() {
  writeStartupLog('========== createWindow 开始 ==========')
  logWindowDebug('createWindow called', win)

  try {
    const { win: mainWindow, showOnStart } = createAppMainWindow({
      app,
      preloadPath: preload,
      viteDevServerUrl: VITE_DEV_SERVER_URL,
      vitePublicPath: process.env.VITE_PUBLIC ?? '',
      logs: {
        debugStartupLog,
        writeStartupLog,
      },
    })
    win = mainWindow

    writeStartupLog('BrowserWindow 创建成功')
    writeMainLog('INFO', 'BrowserWindow created successfully')
    logWindowDebug('BrowserWindow created', win)

    registerMainWindowLifecycleEvents({
      win,
      app,
      showOnStart,
      isQuitting: () => isQuitting,
      logs: {
        debugStartupLog,
        logWindowDebug,
        writeMainLog,
        writeStartupLog,
      },
      onWindowDestroyed: () => {
        win = null
      },
      onRequestRecreate: () => {
        if (!win) {
          void createWindow()
        }
      },
    })

    // 确保任务栏显示
    win.setSkipTaskbar(false)
    windowManager.setMainWindow(win)
    debugStartupLog('窗口已设置到 WindowManager')

    await loadMainWindowContent({
      win,
      viteDevServerUrl: VITE_DEV_SERVER_URL,
      indexHtml,
      isPackaged: app.isPackaged,
      isWindows: process.platform === 'win32',
      logs: {
        debugStartupLog,
        logWindowDebug,
        writeMainLog,
        writeStartupLog,
      },
    })

    registerMainWindowWebContentsEvents({
      win,
      app,
      isQuitting: () => isQuitting,
      buildRendererErrorScript,
      logs: {
        debugStartupLog,
        logWindowDebug,
        writeMainLog,
        writeStartupLog,
      },
      onSilentCheckForUpdate: () => enhancedUpdateManager.silentCheckForUpdate(),
      onRequestRecreate: () => {
        if (!win || win.isDestroyed()) {
          void createWindow()
        }
      },
    })

    registerMainWindowCloseBehavior({
      win,
      isQuitting: () => isQuitting,
      getConfig,
      vitePublicPath: process.env.VITE_PUBLIC ?? '',
      logs: {
        debugStartupLog,
        logWindowDebug,
        writeMainLog,
        writeStartupLog,
      },
    })

    writeStartupLog('========== createWindow 完成 ==========')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    writeStartupLog(`createWindow 错误: ${errorMsg}`)
    writeMainLog('ERROR', `createWindow failed: ${errorMsg}`)
    logWindowDebug('createWindow error', win)

    if (!app.isPackaged) {
      dialog.showErrorBox('窗口创建失败', errorMsg)
    }
  }
}

writeStartupLog('before whenReady')
logWindowDebug('before whenReady', win)

app
  .whenReady()
  .then(() => {
    handleAppReady({
      app,
      vitePublicPath: process.env.VITE_PUBLIC ?? '',
      getMainWindow: () => win,
      createWindow: () => {
        void createWindow()
      },
      createTray,
      startMemoryLogInterval,
      logs: {
        debugStartupLog,
        logStartupInfo,
        logWindowDebug,
        writeStartupLog,
      },
    })
  })
  .catch(err => {
    const errorMsg = err instanceof Error ? err.message : String(err)
    writeStartupLog(`app.whenReady 错误: ${errorMsg}`)
    writeMainLog('ERROR', `app.whenReady failed: ${errorMsg}`)
    console.error('app.whenReady failed:', err)
  })

app.on('window-all-closed', async () => {
  handleWindowAllClosed({
    platform: process.platform,
    isQuitting,
    writeStartupLog,
  })
})

app.on('before-quit', event => {
  if (isQuitting) {
    void handleBeforeQuit({
      isQuitting,
      markQuitting: () => {
        isQuitting = true
        setAppQuitting(true)
      },
      stopMemoryLogInterval,
      cleanupAccountManager: cleanupRuntimeManagers,
      logs: {
        writeStartupLog,
        writeMainLog,
      },
    })
    return
  }

  event.preventDefault()
  void handleBeforeQuit({
    isQuitting,
    markQuitting: () => {
      isQuitting = true
      setAppQuitting(true)
    },
    stopMemoryLogInterval,
    cleanupAccountManager: cleanupRuntimeManagers,
    logs: {
      writeStartupLog,
      writeMainLog,
    },
  })
    .then(() => {
      app.quit()
    })
    .catch(error => {
      writeMainLog('ERROR', `before-quit cleanup failed: ${error}`)
      app.quit()
    })
})

app.on('will-quit', _event => {
  const resources = handleWillQuit({
    tray,
    win,
    logs: {
      writeStartupLog,
      writeMainLog,
    },
  })
  tray = resources.tray
  win = resources.win
})

app.on('activate', () => {
  handleAppActivate({
    allWindows: BrowserWindow.getAllWindows(),
    createWindow: () => {
      void createWindow()
    },
    writeStartupLog,
  })
})

registerAppProcessHandlers({
  isQuitting: () => isQuitting,
  showErrorBox: (title, content) => dialog.showErrorBox(title, content),
  writeCrashToTemp,
  writeStartupLog,
})

function createTray() {
  tray = createAppTray({
    app,
    getMainWindow: () => win,
    createWindow: () => {
      void createWindow()
    },
    quitApp: () => {
      void quitApp()
    },
    vitePublicPath: process.env.VITE_PUBLIC,
    writeStartupLog,
    writeMainLog,
  })
}

/**
 * 统一的退出应用方法
 */
async function quitApp() {
  const resources = await quitElectronApp({
    app,
    isQuitting,
    markQuitting: () => {
      isQuitting = true
      setAppQuitting(true)
    },
    stopMemoryLogInterval,
    cleanupAccountManager: cleanupRuntimeManagers,
    tray,
    win,
    logs: {
      writeStartupLog,
      writeMainLog,
    },
  })
  tray = resources.tray
  win = resources.win
}

registerAppConfigIpc({
  getConfig,
  setConfig,
  writeStartupLog,
})
