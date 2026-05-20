import { describe, expect, it } from 'vitest'
import { getKnownBrowserName, validateBrowserExecutablePath } from '../browser'

describe('browser executable validation', () => {
  it('accepts known browser executables', () => {
    const result = validateBrowserExecutablePath(
      '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    )

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.browserName).toBe('Google Chrome')
      expect(result.executableName).toBe('chrome.exe')
      expect(result.normalizedPath).toBe(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      )
    }
  })

  it('rejects uninstallers and setup helpers', () => {
    const result = validateBrowserExecutablePath(
      'C:\\Users\\Administrator\\AppData\\Roaming\\Google\\Chrome\\App\\uninstall.exe',
    )

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('不是浏览器主程序')
    }
  })

  it('rejects unsupported exe names', () => {
    const result = validateBrowserExecutablePath('C:\\Tools\\not-a-browser.exe')

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('不支持的浏览器文件')
    }
  })

  it('infers display names from browser executables', () => {
    expect(
      getKnownBrowserName('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'),
    ).toBe('Microsoft Edge')
  })
})
