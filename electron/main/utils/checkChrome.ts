import assert from 'node:assert'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ErrorFactory } from '@praha/error-factory'
import {
  type BrowserCandidate,
  type BrowserExecutableValidation,
  validateBrowserExecutablePath,
} from 'shared/browser'
import { createLogger } from '../logger'

const execAsync = promisify(exec)
const logger = createLogger('ChromiumChecker')

interface BrowserConfig {
  id: string
  name: string
  commonPaths: string[]
  processNames: string[]
  appNameForMac?: string
}

type SupportedPlatform = 'win32' | 'darwin'

function uniqByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = process.platform === 'win32' ? item.path.toLowerCase() : item.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toInvalidBrowserPath(
  validation: Extract<BrowserExecutableValidation, { valid: true }>,
  reason: string,
): Extract<BrowserExecutableValidation, { valid: false }> {
  return {
    valid: false,
    executableName: validation.executableName,
    normalizedPath: validation.normalizedPath,
    reason,
  }
}

export function validateBrowserExecutableFile(browserPath: string): BrowserExecutableValidation {
  const validation = validateBrowserExecutablePath(browserPath)
  if (!validation.valid) {
    return validation
  }

  if (!fs.existsSync(validation.normalizedPath)) {
    return toInvalidBrowserPath(validation, `浏览器文件不存在：${validation.normalizedPath}`)
  }

  try {
    if (!fs.statSync(validation.normalizedPath).isFile()) {
      return toInvalidBrowserPath(
        validation,
        `浏览器路径不是可执行文件：${validation.normalizedPath}`,
      )
    }
  } catch (error) {
    return toInvalidBrowserPath(validation, `无法读取浏览器文件：${String(error)}`)
  }

  return validation
}

function toCandidate(config: BrowserConfig, browserPath: string): BrowserCandidate | null {
  const validation = validateBrowserExecutableFile(browserPath)
  if (!validation.valid) {
    logger.warn(`忽略无效浏览器路径 ${browserPath}: ${validation.reason}`)
    return null
  }

  return {
    id: config.id,
    name: validation.browserName || config.name,
    path: validation.normalizedPath,
    source: 'detected',
    engine: 'chromium',
    status: 'unknown',
    lastError: null,
  }
}

function findWindowsByCommonPath(relativePaths: string[]) {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LocalAppData,
  ].filter((r): r is string => !!r)

  for (const root of roots) {
    for (const relativePath of relativePaths) {
      const fullPath = path.join(root, relativePath)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }
  }
  return null
}

function escapePowerShellSingleQuoted(value: string) {
  return value.replace(/'/g, "''")
}

async function findWindowsByRegistry(processNames: string[]) {
  const registryRoots = [
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  ]

  for (const processName of processNames) {
    for (const registryRoot of registryRoots) {
      try {
        const keyPath = `${registryRoot}\\${processName}`
        const escapedKeyPath = escapePowerShellSingleQuoted(keyPath)
        const command = `powershell -NoProfile -Command "$key=Get-Item -LiteralPath '${escapedKeyPath}' -ErrorAction SilentlyContinue; if ($key) { $p=$key.GetValue(''); if ($p) { Write-Output $p } }"`
        const { stdout } = await execAsync(command)
        const result = stdout.trim()

        if (result && fs.existsSync(result)) {
          return result
        }
      } catch (err) {
        logger.debug(`注册表查找 ${processName} 失败: ${err}`)
      }
    }
  }
  return null
}

async function findWindowsByPowerShell(processNames: string[]) {
  for (const processName of processNames) {
    try {
      const name = path.parse(processName).name
      const command = `powershell -NoProfile -Command "Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path"`
      const { stdout } = await execAsync(command)
      const result = stdout.trim()

      if (result && fs.existsSync(result)) {
        return result
      }
    } catch (err) {
      logger.debug(`PowerShell 查找 ${processName} 失败 (可能未运行): ${err}`)
    }
  }
  return null
}

async function findChromiumOnWindows(config: BrowserConfig): Promise<BrowserCandidate | null> {
  const pathFromCommon = findWindowsByCommonPath(config.commonPaths)
  if (pathFromCommon) {
    logger.debug(`通过通用路径找到 ${config.name}: ${pathFromCommon}`)
    return toCandidate(config, pathFromCommon)
  }

  const pathFromRegistry = await findWindowsByRegistry(config.processNames)
  if (pathFromRegistry) {
    logger.debug(`通过注册表找到 ${config.name}: ${pathFromRegistry}`)
    return toCandidate(config, pathFromRegistry)
  }

  const pathFromProcess = await findWindowsByPowerShell(config.processNames)
  if (pathFromProcess) {
    logger.debug(`通过进程列表找到 ${config.name}: ${pathFromProcess}`)
    return toCandidate(config, pathFromProcess)
  }

  logger.debug(`未能找到 ${config.name} (Windows)`)
  return null
}

async function findChromiumOnMac(config: BrowserConfig): Promise<BrowserCandidate | null> {
  for (const p of config.commonPaths) {
    if (fs.existsSync(p)) {
      logger.debug(`通过预定义路径找到 ${config.name}: ${p}`)
      return toCandidate(config, p)
    }
  }

  const appName = config.appNameForMac || config.name
  const command = `osascript -e 'POSIX path of (path to application "${appName}")'`

  try {
    const { stdout } = await execAsync(command)
    const appRoot = stdout.trim()

    if (appRoot) {
      const binaryPath = path.join(appRoot, 'Contents', 'MacOS', appName)
      if (fs.existsSync(binaryPath)) {
        logger.debug(`通过 osascript 找到: ${binaryPath}`)
        return toCandidate(config, binaryPath)
      }
    }
  } catch (error) {
    logger.debug(`osascript 查找失败 ${appName}: ${error}`)
  }

  logger.debug(`未能找到 ${config.name} (MacOS)`)
  return null
}

const CONFIGS: Record<
  SupportedPlatform,
  {
    browsers: BrowserConfig[]
    finder: (config: BrowserConfig) => Promise<BrowserCandidate | null>
  }
> = {
  win32: {
    browsers: [
      {
        id: 'edge',
        name: 'Microsoft Edge',
        commonPaths: ['Microsoft/Edge/Application/msedge.exe'],
        processNames: ['msedge.exe'],
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        commonPaths: ['Google/Chrome/Application/chrome.exe'],
        processNames: ['chrome.exe'],
      },
      {
        id: 'brave',
        name: 'Brave',
        commonPaths: ['BraveSoftware/Brave-Browser/Application/brave.exe'],
        processNames: ['brave.exe'],
      },
      {
        id: '360se',
        name: '360 极速浏览器',
        commonPaths: [
          '360Chrome/Chrome/Application/360chrome.exe',
          '360Chrome/Chrome/Application/360se.exe',
        ],
        processNames: ['360chrome.exe', '360se.exe'],
      },
      {
        id: 'sogou',
        name: '搜狗浏览器',
        commonPaths: ['SogouExplorer/SogouExplorer.exe'],
        processNames: ['SogouExplorer.exe'],
      },
    ],
    finder: findChromiumOnWindows,
  },
  darwin: {
    browsers: [
      {
        id: 'chrome',
        name: 'Google Chrome',
        commonPaths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        processNames: [],
        appNameForMac: 'Google Chrome',
      },
      {
        id: 'edge',
        name: 'Microsoft Edge',
        commonPaths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        processNames: [],
        appNameForMac: 'Microsoft Edge',
      },
      {
        id: 'brave',
        name: 'Brave',
        commonPaths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
        processNames: [],
        appNameForMac: 'Brave Browser',
      },
    ],
    finder: findChromiumOnMac,
  },
}

export async function listDetectedBrowsers(preferEdge = false): Promise<BrowserCandidate[]> {
  const platform = os.platform()
  assert(platform === 'win32' || platform === 'darwin')
  const platformConfig = CONFIGS[platform]

  const orderedConfigs =
    preferEdge && platform === 'win32'
      ? [...platformConfig.browsers].sort(config => (config.id === 'edge' ? -1 : 1))
      : platformConfig.browsers

  const results = await Promise.all(orderedConfigs.map(config => platformConfig.finder(config)))
  return uniqByPath(results.filter((item): item is BrowserCandidate => !!item))
}

export async function listBrowserLaunchCandidates(
  preferredPath?: string | null,
  preferEdge = false,
): Promise<string[]> {
  const preferredPaths: Array<{ path: string }> = []

  if (preferredPath) {
    const validation = validateBrowserExecutableFile(preferredPath)
    if (validation.valid) {
      preferredPaths.push({ path: validation.normalizedPath })
    } else {
      logger.warn(`已保存浏览器路径不可用，将重新检测浏览器: ${validation.reason}`)
    }
  }

  const detectedBrowsers = await listDetectedBrowsers(preferEdge)
  return uniqByPath([...preferredPaths, ...detectedBrowsers]).map(item => item.path)
}

export async function findChromium(edge = false): Promise<string> {
  const browsers = await listDetectedBrowsers(edge)
  const browser = browsers[0]
  if (browser) {
    logger.info(`找到浏览器路径：${browser.path}`)
    return browser.path
  }

  logger.error('未找到任何浏览器路径，请手动选择')
  throw new ChromiumNotFoundError()
}

class ChromiumNotFoundError extends ErrorFactory({
  name: 'ChromiumNotFoundError',
  message: '未找到浏览器的可执行文件',
}) {}
