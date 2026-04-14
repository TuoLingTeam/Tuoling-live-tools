import path from 'node:path'
import type playwright from 'playwright'
import type { BrowserTestResult } from 'shared/browser'
import { createLogger } from '#/logger'
import { findChromium } from '#/utils/checkChrome'
import { buildChromiumLaunchArgs, shouldDisableChromiumSandbox } from './browserLaunchSecurity'

const logger = createLogger('BrowserSessionManager')

// 加载 playwright-core 运行时入口
let chromium: typeof import('playwright').chromium | null = null
try {
  const fs = require('node:fs') as typeof import('fs')

  // 可能的路径列表（按优先级）
  const possiblePaths = [
    path.join(__dirname, 'runtime', 'load-playwright.cjs'), // __dirname = dist-electron/main
    path.join(__dirname, '../runtime', 'load-playwright.cjs'), // __dirname = dist-electron/main/managers
    path.join(__dirname, 'main/runtime', 'load-playwright.cjs'), // __dirname = dist-electron
  ]

  let loadPath: string | null = null
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      loadPath = p
      break
    }
  }

  if (!loadPath) {
    throw new Error(`Cannot find load-playwright.cjs in any of: ${possiblePaths.join(', ')}`)
  }

  logger.debug(`Loading playwright from: ${loadPath}`)
  logger.debug(`__dirname: ${__dirname}`)

  const loaded = require(loadPath) as { chromium: typeof import('playwright').chromium }
  chromium = loaded.chromium
  if (!chromium) {
    logger.error('playwright runtime loaded but chromium is undefined')
  } else {
    logger.info('playwright runtime loaded successfully')
  }
} catch (error) {
  logger.error('Failed to load playwright runtime:', error)
}

export interface BrowserSession {
  browser: playwright.Browser
  context: playwright.BrowserContext
  page: playwright.Page
}

export interface BrowserConfig {
  headless?: boolean
  storageState?: string
}

export type StorageState = playwright.BrowserContextOptions['storageState']

class BrowserSessionManager {
  private browserPath: string | null = null

  public setBrowserPath(path: string) {
    this.browserPath = path
  }

  private async getBrowserPathOrDefault() {
    if (!this.browserPath) {
      this.browserPath = await findChromium()
    }
    return this.browserPath
  }

  private async createBrowser(headless = true, executablePath?: string) {
    console.log(
      `[BrowserPopup] [BrowserSessionManager] createBrowser() called with headless=${headless}`,
    )
    logger.info(`[Browser] createBrowser called with headless=${headless}`)
    if (!chromium) {
      const errorMsg = 'playwright 运行时未能正确加载，无法启动浏览器'
      console.error('[BrowserPopup] [BrowserSessionManager] chromium is null or undefined')
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    if (typeof chromium.launch !== 'function') {
      const errorMsg = `chromium.launch 不是函数，chromium 类型: ${typeof chromium}, 属性: ${Object.keys(chromium).join(', ')}`
      console.error('[BrowserPopup] [BrowserSessionManager] chromium.launch is not a function')
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    const execPath = executablePath || (await this.getBrowserPathOrDefault())
    console.log(`[BrowserPopup] [BrowserSessionManager] Browser path: ${execPath}`)
    logger.info(`Launching browser: headless=${headless}, execPath=${execPath}`)

    const args = buildChromiumLaunchArgs(headless)
    if (headless && shouldDisableChromiumSandbox()) {
      logger.warn(
        '[Browser] Chromium sandbox disabled via PLAYWRIGHT_DISABLE_SANDBOX=true; use only when the host environment requires it',
      )
    }

    try {
      console.log('[BrowserPopup] [BrowserSessionManager] Calling chromium.launch()')
      const browser = await chromium.launch({
        headless,
        executablePath: execPath,
        args,
      })
      console.log(
        `[BrowserPopup] [BrowserSessionManager] Browser launched successfully, isConnected: ${browser.isConnected()}`,
      )
      logger.info('Browser launched successfully')
      return browser
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message || error.name || error.toString()
          : typeof error === 'string'
            ? error
            : JSON.stringify(error)
      console.error(
        `[BrowserPopup] [BrowserSessionManager] chromium.launch() failed: ${errorMessage}`,
      )
      const errorStack = error instanceof Error ? error.stack : undefined
      logger.error(`Failed to launch browser: ${errorMessage}`)
      if (errorStack) {
        logger.error(`Stack trace: ${errorStack}`)
      }
      throw new Error(`浏览器启动失败: ${errorMessage}`)
    }
  }

  public async createSession(
    headless = true,
    storageState?: StorageState,
  ): Promise<BrowserSession> {
    console.log(
      `[BrowserPopup] [BrowserSessionManager] createSession() called with headless=${headless}`,
    )
    const browser = await this.createBrowser(headless)
    console.log('[BrowserPopup] [BrowserSessionManager] Browser created, creating context...')
    const context = await browser.newContext({
      viewport: null,
      storageState,
    })
    console.log('[BrowserPopup] [BrowserSessionManager] Context created, creating page...')
    const page = await context.newPage()
    console.log('[BrowserPopup] [BrowserSessionManager] Page created, session ready')
    return { browser, context, page }
  }

  public async testBrowserLaunch(browserPath: string): Promise<BrowserTestResult> {
    try {
      const browser = await this.createBrowser(true, browserPath)
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' })
      await browser.close()

      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '浏览器启动失败'
      logger.warn(`[Browser] test launch failed: ${errorMessage}`)
      return {
        success: false,
        error: errorMessage,
      }
    }
  }
}

export const browserManager = new BrowserSessionManager()
