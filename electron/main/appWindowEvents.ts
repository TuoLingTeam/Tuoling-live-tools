import path from 'node:path'
import { type App, type BrowserWindow, Notification, shell } from 'electron'
import type { AppConfig } from './appConfigStore'

type LogFns = {
  debugStartupLog: (message: string) => void
  logWindowDebug: (phase: string, windowRef: BrowserWindow | null) => void
  writeMainLog: (level: string, message: string) => void
  writeStartupLog: (message: string) => void
}

type RendererErrorScriptBuilder = (
  title: string,
  entries: Array<[label: string, value: unknown]>,
) => string

export function registerMainWindowLifecycleEvents(params: {
  win: BrowserWindow
  app: App
  showOnStart: boolean
  isQuitting: () => boolean
  logs: LogFns
  onWindowDestroyed: () => void
  onRequestRecreate: () => void
}) {
  const { win, app, showOnStart, isQuitting, logs, onWindowDestroyed, onRequestRecreate } = params

  win.once('ready-to-show', () => {
    logs.debugStartupLog('事件: ready-to-show 触发')
    logs.logWindowDebug('ready-to-show', win)

    if (!win.isDestroyed()) {
      win.show()
      logs.debugStartupLog('窗口已显示 (ready-to-show)')

      if (showOnStart) {
        win.focus()
        logs.debugStartupLog('窗口已聚焦')
      }
    }
  })

  win.on('show', () => {
    logs.debugStartupLog('事件: show 触发')
    logs.logWindowDebug('show', win)
    logs.writeMainLog('INFO', 'Window shown')
  })

  win.on('focus', () => {
    logs.debugStartupLog('事件: focus 触发')
    logs.logWindowDebug('focus', win)
  })

  win.on('closed', () => {
    logs.debugStartupLog('事件: closed 触发')
    logs.logWindowDebug('window closed', win)

    if (win.isDestroyed()) {
      onWindowDestroyed()
      logs.debugStartupLog('窗口引用已清理')
    }

    if (app.isPackaged && process.platform === 'win32' && !isQuitting()) {
      logs.writeMainLog('WARN', '检测到窗口异常关闭，准备重建窗口')
      setTimeout(() => {
        if (!isQuitting()) {
          logs.logWindowDebug('window closed recovery: recreate window', null)
          logs.writeMainLog('WARN', 'Window closed unexpectedly, recreating...')
          onRequestRecreate()
        }
      }, 1000)
    }
  })

  win.on('unresponsive', () => {
    logs.writeMainLog('ERROR', 'Window became unresponsive')
  })

  win.on('responsive', () => {
    logs.debugStartupLog('事件: responsive 触发（窗口恢复响应）')
  })
}

export function registerMainWindowWebContentsEvents(params: {
  win: BrowserWindow
  app: App
  isQuitting: () => boolean
  buildRendererErrorScript: RendererErrorScriptBuilder
  logs: LogFns
  onSilentCheckForUpdate: () => Promise<void>
  onRequestRecreate: () => void
}) {
  const {
    win,
    app,
    isQuitting,
    buildRendererErrorScript,
    logs,
    onSilentCheckForUpdate,
    onRequestRecreate,
  } = params

  win.webContents.on('did-finish-load', async () => {
    logs.writeStartupLog('页面加载完成')

    if (!isQuitting()) {
      await onSilentCheckForUpdate()
    }
  })

  win.webContents.on(
    'did-fail-load',
    (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logs.debugStartupLog(
        `事件: did-fail-load 触发 - errorCode=${errorCode}, errorDescription=${errorDescription}, isMainFrame=${isMainFrame}`,
      )
      logs.debugStartupLog(`事件: did-fail-load - validatedURL=${validatedURL}`)
      logs.writeMainLog(
        'ERROR',
        `Page failed to load: ${errorDescription} (${errorCode}) at ${validatedURL}`,
      )

      if (app.isPackaged && !win.isDestroyed()) {
        logs.debugStartupLog('加载失败，尝试显示错误信息')
        win.webContents
          .executeJavaScript(
            buildRendererErrorScript('页面加载失败', [
              ['错误码', errorCode],
              ['错误描述', errorDescription],
              ['URL', validatedURL],
              ['主框架', isMainFrame],
              ['时间', new Date().toISOString()],
            ]),
          )
          .catch(() => {})
        win.show()
      }
    },
  )

  win.webContents.on('render-process-gone', (_, details) => {
    logs.debugStartupLog(
      `事件: render-process-gone 触发 - reason=${details.reason}, exitCode=${details.exitCode}`,
    )
    logs.debugStartupLog(`事件: render-process-gone - details: ${JSON.stringify(details)}`)
    logs.writeMainLog('ERROR', `render-process-gone: ${JSON.stringify(details)}`)
    logs.logWindowDebug(`render-process-gone: ${details.reason}`, win)

    if (app.isPackaged && !win.isDestroyed()) {
      logs.debugStartupLog('渲染进程崩溃，尝试显示错误信息')
      try {
        win.webContents
          .executeJavaScript(
            buildRendererErrorScript('渲染进程崩溃', [
              ['原因', details.reason],
              ['退出码', details.exitCode],
              ['时间', new Date().toISOString()],
            ]),
          )
          .catch(() => {})
        win.show()
      } catch (error) {
        logs.writeStartupLog(`显示错误信息失败: ${error}`)
      }
    }

    if (app.isPackaged && process.platform === 'win32' && !isQuitting()) {
      setTimeout(() => {
        if (!isQuitting()) {
          logs.logWindowDebug('render-process-gone recovery: recreate window', null)
          logs.writeMainLog('WARN', 'Recreating window after render process crash')
          onRequestRecreate()
        }
      }, 1000)
    }
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelStr = ['debug', 'info', 'warning', 'error'][level] || 'unknown'
    const sensitivePatterns = [
      /token[=:]\s*["']?[a-zA-Z0-9_\-.]+["']?/gi,
      /password[=:]\s*["']?[^"'\s]+["']?/gi,
      /code[=:]\s*["']?\d{4,8}["']?/gi,
      /secret[=:]\s*["']?[^"'\s]+["']?/gi,
      /authorization[:\s]+["']?bearer\s+[a-zA-Z0-9_\-.]+["']?/gi,
      /([?&])(token|password|code|secret)=[^&]*/gi,
    ]

    let sanitizedMessage = message
    for (const pattern of sensitivePatterns) {
      sanitizedMessage = sanitizedMessage.replace(pattern, '[REDACTED]')
    }

    if (levelStr !== 'debug') {
      logs.writeMainLog('RENDERER', `[${levelStr}] ${sanitizedMessage} (${sourceId}:${line})`)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

export function registerMainWindowCloseBehavior(params: {
  win: BrowserWindow
  isQuitting: () => boolean
  getConfig: () => AppConfig
  vitePublicPath: string
  logs: LogFns
}) {
  const { win, isQuitting, getConfig, vitePublicPath, logs } = params

  win.on('close', event => {
    logs.writeStartupLog(
      `事件: close 触发 - isQuitting=${isQuitting()}, platform=${process.platform}`,
    )

    if (win.isDestroyed()) {
      return
    }

    if (isQuitting()) {
      logs.writeStartupLog('应用正在退出，允许关闭窗口')
      return
    }

    const config = getConfig()
    const closeBehavior = config.closeBehavior || 'tray'

    if (closeBehavior === 'quit') {
      logs.writeStartupLog('配置为直接退出，允许关闭窗口')
      return
    }

    event.preventDefault()
    logs.writeStartupLog('拦截关闭事件，改为隐藏到托盘')

    const shouldShowTip = !config.hideToTrayTipDismissed

    if (!win.isDestroyed()) {
      win.hide()
      win.setSkipTaskbar(true)
      logs.writeStartupLog('窗口已隐藏到托盘')
    }

    if (shouldShowTip && Notification.isSupported()) {
      const notification = new Notification({
        title: '已最小化到托盘',
        body: '应用仍在后台运行，可从托盘图标打开。可在设置中关闭此提示。',
        icon: path.join(vitePublicPath, 'favicon.png'),
        silent: false,
      })

      notification.on('click', () => {
        if (!win.isDestroyed()) {
          win.show()
          win.setSkipTaskbar(false)
          win.focus()
        }
      })

      notification.show()
    }
  })
}
