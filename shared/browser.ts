export type BrowserSource = 'detected' | 'manual'

export type BrowserEngine = 'chromium' | 'unknown'

export type BrowserVerificationStatus = 'verified' | 'failed' | 'unknown'

export type BrowserExecutableValidation =
  | {
      valid: true
      browserName: string
      executableName: string
      normalizedPath: string
    }
  | {
      valid: false
      executableName: string
      normalizedPath: string
      reason: string
    }

export interface BrowserCandidate {
  id: string
  name: string
  path: string
  source: BrowserSource
  engine: BrowserEngine
  status: BrowserVerificationStatus
  lastError?: string | null
}

export interface BrowserTestResult {
  success: boolean
  error?: string
}

const SUPPORTED_BROWSER_EXECUTABLES: Record<string, string> = {
  'msedge.exe': 'Microsoft Edge',
  'chrome.exe': 'Google Chrome',
  'brave.exe': 'Brave',
  '360chrome.exe': '360 极速浏览器',
  '360se.exe': '360 极速浏览器',
  'sogouexplorer.exe': '搜狗浏览器',
  'google chrome': 'Google Chrome',
  'microsoft edge': 'Microsoft Edge',
  'brave browser': 'Brave',
}

const BLOCKED_EXECUTABLE_NAMES = new Set([
  'uninstall.exe',
  'setup.exe',
  'installer.exe',
  'update.exe',
  'updater.exe',
])

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function normalizeBrowserPath(browserPath: string) {
  return stripWrappingQuotes(browserPath)
}

export function getBrowserExecutableName(browserPath: string) {
  const normalized = normalizeBrowserPath(browserPath).replace(/\\/g, '/')
  return normalized.split('/').pop()?.trim() || ''
}

export function getKnownBrowserName(browserPath: string) {
  const executableName = getBrowserExecutableName(browserPath)
  return SUPPORTED_BROWSER_EXECUTABLES[executableName.toLowerCase()] ?? executableName
}

export function validateBrowserExecutablePath(browserPath: string): BrowserExecutableValidation {
  const normalizedPath = normalizeBrowserPath(browserPath)
  const executableName = getBrowserExecutableName(normalizedPath)
  const normalizedExecutableName = executableName.toLowerCase()

  if (!normalizedPath) {
    return {
      valid: false,
      executableName,
      normalizedPath,
      reason: '浏览器路径为空，请重新选择浏览器主程序。',
    }
  }

  if (!executableName) {
    return {
      valid: false,
      executableName,
      normalizedPath,
      reason: '无法识别浏览器文件名，请重新选择浏览器主程序。',
    }
  }

  if (BLOCKED_EXECUTABLE_NAMES.has(normalizedExecutableName)) {
    return {
      valid: false,
      executableName,
      normalizedPath,
      reason: `当前选择的是 ${executableName}，不是浏览器主程序。请重新选择 chrome.exe、msedge.exe 等浏览器文件。`,
    }
  }

  const browserName = SUPPORTED_BROWSER_EXECUTABLES[normalizedExecutableName]
  if (!browserName) {
    return {
      valid: false,
      executableName,
      normalizedPath,
      reason: `不支持的浏览器文件：${executableName}。请重新选择 Edge、Chrome、Brave、360 极速浏览器或搜狗浏览器的主程序。`,
    }
  }

  return {
    valid: true,
    browserName,
    executableName,
    normalizedPath,
  }
}
