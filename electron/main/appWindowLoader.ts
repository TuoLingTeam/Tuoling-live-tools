import { existsSync, readdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { createLogger } from './logger'

type LogFns = {
  debugStartupLog: (message: string) => void
  logWindowDebug: (phase: string, windowRef: BrowserWindow | null) => void
  writeMainLog: (level: string, message: string) => void
  writeStartupLog: (message: string) => void
}

function waitForDevServer(
  url: string,
  maxWaitMs = 60000,
  intervalMs = 1000,
  initialDelayMs = 500,
): Promise<void> {
  let host = '127.0.0.1'
  let port = 5173

  try {
    const parsedUrl = new URL(url)
    host = parsedUrl.hostname || host
    port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : 5173
  } catch {
    // 保持默认值
  }

  return new Promise(resolve => {
    const start = Date.now()

    function tryConnect() {
      if (Date.now() - start >= maxWaitMs) {
        resolve()
        return
      }

      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        setTimeout(tryConnect, intervalMs)
      }, 3000)

      socket.once('connect', () => {
        clearTimeout(timeout)
        socket.destroy()
        resolve()
      })

      socket.once('error', () => {
        clearTimeout(timeout)
        socket.destroy()
        setTimeout(tryConnect, intervalMs)
      })

      socket.connect(port, host)
    }

    setTimeout(tryConnect, initialDelayMs)
  })
}

export async function loadMainWindowContent(params: {
  win: BrowserWindow
  viteDevServerUrl?: string
  indexHtml: string
  isPackaged: boolean
  isWindows: boolean
  logs: LogFns
}) {
  const { win, viteDevServerUrl, indexHtml, isPackaged, isWindows, logs } = params

  const DEV_LOAD_RETRY_MAX = 5
  const DEV_LOAD_RETRY_DELAY_MS = 6000
  let devLoadRetryCount = 0

  if (viteDevServerUrl) {
    logs.debugStartupLog('开发模式：从 Vite 开发服务器加载')
    console.log('[main] 等待 Vite 开发服务器 (localhost:5173)...')
    await waitForDevServer(viteDevServerUrl).catch(() => {})
    console.log('[main] 正在加载页面:', viteDevServerUrl)
    logs.debugStartupLog(`正在加载页面: ${viteDevServerUrl}`)

    win
      .loadURL(viteDevServerUrl)
      .then(() => {
        logs.debugStartupLog('loadURL 成功')
      })
      .catch(err => {
        logs.writeStartupLog(`loadURL 失败: ${err.message}`)
        logs.writeMainLog('ERROR', `loadURL failed: ${err.message}`)
        logs.logWindowDebug('loadURL failed', win)
      })

    win.webContents.on(
      'did-fail-load',
      (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
        logs.debugStartupLog(
          `did-fail-load: errorCode=${errorCode}, errorDescription=${errorDescription}`,
        )

        if (
          !viteDevServerUrl ||
          !isMainFrame ||
          errorCode !== -102 ||
          errorDescription !== 'ERR_CONNECTION_REFUSED' ||
          !validatedURL?.startsWith('http://localhost:')
        ) {
          return
        }
        if (devLoadRetryCount >= DEV_LOAD_RETRY_MAX) {
          console.log('[main] 开发页面加载已重试', DEV_LOAD_RETRY_MAX, '次，请检查 Vite 是否已启动')
          logs.debugStartupLog(`开发页面加载已重试 ${DEV_LOAD_RETRY_MAX} 次，放弃重试`)
          return
        }

        devLoadRetryCount += 1
        console.log('[main] 开发页面加载失败，', DEV_LOAD_RETRY_DELAY_MS / 1000, '秒后重试')
        logs.debugStartupLog(
          `开发页面加载失败，${DEV_LOAD_RETRY_DELAY_MS / 1000}秒后重试 (${devLoadRetryCount}/${DEV_LOAD_RETRY_MAX})`,
        )

        setTimeout(() => {
          if (win.isDestroyed() || win.webContents.isDestroyed() || !viteDevServerUrl) {
            return
          }

          win.loadURL(viteDevServerUrl).catch(err => {
            createLogger('window').error('loadURL retry failed:', err)
          })
        }, DEV_LOAD_RETRY_DELAY_MS)
      },
    )

    win.webContents.openDevTools()
    return
  }

  logs.debugStartupLog('生产模式：从本地文件加载')
  logs.debugStartupLog(`正在加载文件: ${indexHtml}`)

  if (!existsSync(indexHtml)) {
    const errorMsg = `index.html 不存在: ${indexHtml}`
    logs.writeStartupLog(`错误: ${errorMsg}`)
    logs.writeMainLog('ERROR', errorMsg)

    try {
      const parentDir = path.dirname(indexHtml)
      if (existsSync(parentDir)) {
        const files = readdirSync(parentDir)
        logs.debugStartupLog(`目录 ${parentDir} 内容: ${files.join(', ')}`)
      } else {
        logs.debugStartupLog(`父目录不存在: ${parentDir}`)
      }
    } catch (error) {
      logs.debugStartupLog(`无法列出目录: ${error}`)
    }
  }

  win
    .loadFile(indexHtml)
    .then(() => {
      logs.debugStartupLog('loadFile 成功')
    })
    .catch(err => {
      logs.writeStartupLog(`loadFile 失败: ${err.message}`)
      logs.writeMainLog('ERROR', `loadFile failed: ${err.message}`)
      logs.logWindowDebug('loadFile failed', win)

      if (isPackaged && isWindows) {
        logs.debugStartupLog('准备重试加载...')
        setTimeout(() => {
          if (win.isDestroyed()) {
            return
          }

          logs.debugStartupLog('重试加载文件...')
          win.loadFile(indexHtml).catch(retryErr => {
            logs.debugStartupLog(`重试失败: ${retryErr.message}`)
            logs.writeMainLog('ERROR', `loadFile retry failed: ${retryErr.message}`)
          })
        }, 1200)
      }
    })
}
