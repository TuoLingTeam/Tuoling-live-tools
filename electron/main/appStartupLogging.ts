import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { App, BrowserWindow } from 'electron'
import { createLogger } from './logger'

export function createAppStartupLogging(app: App) {
  const tempLogDir = process.env.TEMP || process.env.TMP || os.tmpdir()
  const fallbackLogPath = path.join(tempLogDir, 'xiuer-live-assistant')

  let startupLogDir = ''
  let startupLogPath = ''
  let mainLogPath = ''
  let logDirEnsured = false

  const STARTUP_DEBUG = process.env.LOG_LEVEL === 'debug' || process.env.STARTUP_DEBUG === '1'
  const windowDebugPath = path.join(process.env.TEMP ?? os.tmpdir(), 'xiuer-window-debug.txt')
  const crashLogPath = path.join(process.env.TEMP ?? os.tmpdir(), 'xiuer-crash.txt')

  function initLogPaths() {
    try {
      startupLogDir = path.join(app.getPath('userData'), 'logs')
      startupLogPath = path.join(startupLogDir, 'startup.log')
      mainLogPath = path.join(startupLogDir, 'main.log')
    } catch (_error) {
      startupLogDir = fallbackLogPath
      startupLogPath = path.join(fallbackLogPath, 'startup.log')
      mainLogPath = path.join(fallbackLogPath, 'main.log')
    }
  }

  function ensureLogDir() {
    if (logDirEnsured) return
    const dirs = [startupLogDir, fallbackLogPath]
    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
      } catch (_error) {
        // 继续尝试下一个目录
      }
    }
    logDirEnsured = true
  }

  function writeStartupLog(message: string) {
    ensureLogDir()
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [STARTUP] [PID:${process.pid}] ${message}\n`
    const logPaths = [startupLogPath, mainLogPath, path.join(fallbackLogPath, 'startup.log')]

    for (const logPath of logPaths) {
      try {
        appendFileSync(logPath, logLine)
      } catch (_error) {
        // 继续尝试下一个路径
      }
    }

    console.log(`[STARTUP] ${message}`)
  }

  function writeMainLog(level: string, message: string) {
    ensureLogDir()
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level}] [PID:${process.pid}] ${message}\n`
    const logPaths = [mainLogPath, path.join(fallbackLogPath, 'main.log')]

    for (const logPath of logPaths) {
      try {
        appendFileSync(logPath, logLine)
      } catch (_error) {
        // 继续尝试下一个路径
      }
    }
  }

  function debugStartupLog(message: string) {
    if (STARTUP_DEBUG) {
      writeStartupLog(message)
    }
  }

  function createBoxedString(lines: string[]) {
    const maxLength = Math.max(...lines.map(line => line.length))
    const horizontalLine = `+${'-'.repeat(maxLength + 2)}+`
    const content = lines.map(line => `| ${line.padEnd(maxLength)} |`).join('\n')
    return `\n${horizontalLine}\n${content}\n${horizontalLine}`
  }

  function buildRendererErrorScript(
    title: string,
    entries: Array<[label: string, value: unknown]>,
  ): string {
    const payload = JSON.stringify({
      title,
      entries: entries.map(([label, value]) => [label, String(value)]),
    })

    return `
      (() => {
        const payload = ${payload};
        const container = document.createElement('div');
        container.style.cssText = 'padding:20px;font-family:sans-serif;';

        const heading = document.createElement('h1');
        heading.textContent = payload.title;
        container.appendChild(heading);

        for (const [label, value] of payload.entries) {
          const line = document.createElement('p');
          line.textContent = \`\${label}: \${value}\`;
          container.appendChild(line);
        }

        document.body.replaceChildren(container);
      })();
    `
  }

  function logStartupInfo() {
    const appInfo = [
      `App Name:     ${app.getName()}`,
      `App Version:  ${app.getVersion()}`,
      `Electron Ver: ${process.versions.electron}`,
      `Node Ver:     ${process.versions.node}`,
      `Platform:     ${process.platform} (${process.arch})`,
      `Environment:  ${app.isPackaged ? 'Production' : 'Development'}`,
    ]
    const logger = createLogger('startup')
    logger.debug(createBoxedString(appInfo))
  }

  function logWindowDebug(phase: string, windowRef: BrowserWindow | null): void {
    if (!STARTUP_DEBUG) return
    const ts = new Date().toISOString()
    const isVisible = windowRef && !windowRef.isDestroyed() ? windowRef.isVisible() : false
    const isMinimized = windowRef && !windowRef.isDestroyed() ? windowRef.isMinimized() : false
    const isFocused = windowRef && !windowRef.isDestroyed() ? windowRef.isFocused() : false
    const line = `${ts} pid=${process.pid} ${phase} mainWindow=${!!windowRef} visible=${isVisible} minimized=${isMinimized} focused=${isFocused}\n`

    try {
      appendFileSync(windowDebugPath, line)
    } catch (_error) {
      // 忽略
    }

    writeStartupLog(
      `[WindowDebug] ${phase} - visible=${isVisible}, minimized=${isMinimized}, focused=${isFocused}`,
    )
  }

  function writeCrashToTemp(tag: string, error: unknown): void {
    try {
      const ts = new Date().toISOString()
      const stack = error instanceof Error ? error.stack : String(error)
      const message = error instanceof Error ? error.message : String(error)
      appendFileSync(crashLogPath, `\n[${ts}] ${tag}\n${message}\n${stack}\n`)
    } catch {
      // 忽略
    }
  }

  initLogPaths()

  return {
    STARTUP_DEBUG,
    buildRendererErrorScript,
    debugStartupLog,
    logStartupInfo,
    logWindowDebug,
    writeCrashToTemp,
    writeMainLog,
    writeStartupLog,
  }
}
