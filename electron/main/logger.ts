import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import electronLog, { type FormatParams, type LogFunctions, type LogMessage } from 'electron-log'
import {
  cleanupOldDatedLogs,
  formatLogDate,
  getDatedLogPath,
  LOG_RETENTION_DAYS,
} from './logFilePolicy'

// 全局退出标志，由 app.ts 在 before-quit 时设置
export let isAppQuitting = false
export function setAppQuitting(value: boolean) {
  isAppQuitting = value
}

// [LOG-LEVEL] 日志级别控制
// 生产环境默认不输出 debug 级日志
const LOG_LEVEL = process.env.LOG_LEVEL || (app.isPackaged ? 'info' : 'debug')
const isDebugEnabled = LOG_LEVEL === 'debug' || LOG_LEVEL === 'verbose'
const shouldWriteConsoleLogs = !app.isPackaged || process.env.MAIN_LOG_TO_CONSOLE === '1'
const datedLogCleanupDates = new Map<string, string>()

// [SECURITY] 敏感信息脱敏配置
const SENSITIVE_PATTERNS = [
  // token / password / code / secret / key
  { pattern: /token[=:]\s*["']?[a-zA-Z0-9_\-.]+["']?/gi, replacement: 'token=***' },
  { pattern: /password[=:]\s*["']?[^"'\s]+["']?/gi, replacement: 'password=***' },
  { pattern: /code[=:]\s*["']?\d{4,8}["']?/gi, replacement: 'code=***' },
  { pattern: /secret[=:]\s*["']?[^"'\s]+["']?/gi, replacement: 'secret=***' },
  { pattern: /key[=:]\s*["']?[a-zA-Z0-9]{16,}["']?/gi, replacement: 'key=***' },
  // Authorization header
  {
    pattern: /authorization[:\s]+["']?bearer\s+[a-zA-Z0-9_\-.]+["']?/gi,
    replacement: 'authorization: Bearer ***',
  },
  // cookie with session
  { pattern: /cookie[:\s]+.*?session[^;]*/gi, replacement: 'cookie: session=***' },
  // URL with query params containing sensitive data
  { pattern: /([?&])(token|password|code|secret|key)=[^&]*/gi, replacement: '$1$2=***' },
]

/**
 * [SECURITY] 敏感信息脱敏处理
 * 对日志内容进行脱敏，防止敏感信息泄露
 */
function sanitizeLogData(data: unknown[]): unknown[] {
  return data.map(item => {
    if (typeof item === 'string') {
      let sanitized = item
      for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, replacement)
      }
      return sanitized
    }
    // 对于对象，转换为字符串后脱敏
    if (item && typeof item === 'object') {
      try {
        const str = JSON.stringify(item)
        let sanitized = str
        for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
          sanitized = sanitized.replace(pattern, replacement)
        }
        return sanitized
      } catch {
        return item
      }
    }
    return item
  })
}

const appRoot = path.join(app.getAppPath(), path.sep)
const cleanPathRegex = new RegExp(appRoot.replace(/\\/g, '\\\\').replace(/\//g, '[\\\\/]'), 'gi')

function cleanStack(stack?: string) {
  if (!stack) return stack
  return stack.replace(cleanPathRegex, `APP:${path.sep}`)
}

function formatLogData(data: FormatParams['data'], _level: FormatParams['level']) {
  function errorMessage(item: Error) {
    return `${item.message}\n${cleanStack(item.stack)}${item.cause ? `\nCaused by: ${item.cause}` : ''}`
  }
  return data.map(item => (item instanceof Error ? errorMessage(item) : item)).join(' ')
}

function getFallbackLogDir(): string {
  return path.join(process.env.TEMP || process.env.TMP || os.tmpdir(), 'xiuer-live-assistant')
}

function getElectronLogDir(message: LogMessage): string {
  const libraryDefaultDir = message.variables?.libraryDefaultDir
  if (typeof libraryDefaultDir === 'string' && libraryDefaultDir.length > 0) {
    return libraryDefaultDir
  }

  try {
    return app.getPath('logs')
  } catch {
    return getFallbackLogDir()
  }
}

function ensureDirectory(dirPath: string) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function cleanupDatedLogDirOnce(logDir: string, date: Date) {
  const dateKey = formatLogDate(date)
  if (datedLogCleanupDates.get(logDir) === dateKey) return

  datedLogCleanupDates.set(logDir, dateKey)
  cleanupOldDatedLogs([logDir], {
    now: date,
    retentionDays: LOG_RETENTION_DAYS,
  })
}

function formatFileLogLine(message: LogMessage): string {
  const sanitizedData = sanitizeLogData(message.data)
  const text = formatLogData(sanitizedData, message.level)
  return [
    `[${message.date.toISOString().replace('T', ' ').slice(0, -1)}]`,
    `[${message.level.toUpperCase()}]`,
    message.scope ? `[${message.scope}]` : '',
    `\t${text}`,
  ]
    .filter(Boolean)
    .join(' ')
}

function writeDatedElectronLog(message: LogMessage) {
  try {
    const logDir = getElectronLogDir(message)
    ensureDirectory(logDir)
    cleanupDatedLogDirOnce(logDir, message.date)
    appendFileSync(getDatedLogPath(logDir, 'main', message.date), `${formatFileLogLine(message)}\n`)
  } catch {
    // Dated log archives are best-effort; keep the primary electron-log transport alive.
  }
}

// [LOG-LEVEL] 根据环境控制 debug 日志输出。
// 打包应用默认关闭 console transport，避免 GUI 进程向失效 stdout/stderr 写入时触发 EIO。
electronLog.transports.file.level = isDebugEnabled ? 'debug' : 'info'
electronLog.transports.console.level = shouldWriteConsoleLogs
  ? isDebugEnabled
    ? 'debug'
    : 'info'
  : false

// [2025-02-11 07:30:03.037] [中控台] » INFO         启动中……
electronLog.transports.console.format = ({ data, level, message }) => {
  // [SECURITY] 脱敏处理
  const sanitizedData = sanitizeLogData(data)
  const text = formatLogData(sanitizedData, level)
  return [
    `[${message.date.toLocaleString()}]`,
    message.scope ? `[${message.scope}]` : '',
    '»',
    `${level.toUpperCase()}`,
    `\t${text}`,
  ]
}

electronLog.transports.file.format = ({ data, level, message }) => {
  // [SECURITY] 脱敏处理
  const sanitizedData = sanitizeLogData(data)
  const text = formatLogData(sanitizedData, level)
  return [
    `[${message.date.toISOString().replace('T', ' ').slice(0, -1)}]`,
    `[${level.toUpperCase()}]`,
    message.scope ? `[${message.scope}]` : '',
    `\t${text}`,
  ]
}
electronLog.hooks.push((message, _transport, transportName) => {
  if (transportName === 'file') {
    writeDatedElectronLog(message)
  }
  return message
})
electronLog.scope.labelPadding = false
electronLog.addLevel('success', 3)

export interface ScopedLogger extends LogFunctions {
  scope(name: string): ScopedLogger
}

export function createLogger(name: string): ScopedLogger {
  const logger = electronLog.scope(name)
  return {
    scope(scopeName: string) {
      const newScopeName = `${name} -> ${scopeName}`
      return createLogger(newScopeName)
    },
    ...logger,
  }
}

export default electronLog
