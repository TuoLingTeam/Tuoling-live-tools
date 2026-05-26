import path from 'node:path'
import { app } from 'electron'
import type playwright from 'playwright'
import type { BrowserTestResult } from 'shared/browser'
import { createLogger } from '#/logger'
import {
  findChromium,
  listBrowserLaunchCandidates,
  validateBrowserExecutableFile,
} from '#/utils/checkChrome'
import {
  buildChromiumLaunchArgs,
  buildChromiumUserLaunchArgs,
  shouldDisableChromiumSandbox,
} from './browserLaunchSecurity'

const logger = createLogger('BrowserSessionManager')
const SHARED_HEADLESS_BROWSER_IDLE_MS = 30_000

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
  browserOwnership: 'exclusive' | 'shared' | 'persistent'
  isHeadless: boolean
  persistentProfileDir?: string
}

export interface BrowserConfig {
  headless?: boolean
  storageState?: string
}

export type StorageState = playwright.BrowserContextOptions['storageState']

interface BrowserLaunchOptions {
  allowFallback?: boolean
}

function sanitizeProfileSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  return sanitized || 'default'
}

function normalizePathForCompare(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function formatLaunchError(error: unknown) {
  return error instanceof Error
    ? error.message || error.name || error.toString()
    : typeof error === 'string'
      ? error
      : JSON.stringify(error)
}

class BrowserSessionManager {
  private browserPath: string | null = null
  private launchQueue: Promise<void> = Promise.resolve()
  private sharedHeadlessBrowser: playwright.Browser | null = null
  private sharedHeadlessBrowserPromise: Promise<playwright.Browser> | null = null
  private sharedHeadlessRefCount = 0
  private sharedHeadlessCloseTimer: ReturnType<typeof setTimeout> | null = null

  public setBrowserPath(browserPath: string) {
    const validation = validateBrowserExecutableFile(browserPath)
    if (!validation.valid) {
      logger.warn(`[Browser] 忽略无效浏览器路径: ${validation.reason}`)
      this.browserPath = null
      return
    }

    this.browserPath = validation.normalizedPath
  }

  private clearCachedBrowserPathIfMatched(browserPath: string) {
    if (
      this.browserPath &&
      normalizePathForCompare(this.browserPath) === normalizePathForCompare(browserPath)
    ) {
      this.browserPath = null
    }
  }

  private rememberSuccessfulBrowserPath(browserPath: string) {
    this.browserPath = browserPath
  }

  private async resolveBrowserLaunchCandidates(
    executablePath?: string,
    allowFallback = true,
  ): Promise<string[]> {
    if (!allowFallback) {
      const candidate = executablePath || this.browserPath || (await findChromium())
      const validation = validateBrowserExecutableFile(candidate)
      if (!validation.valid) {
        throw new Error(`浏览器路径无效：${validation.reason}`)
      }
      return [validation.normalizedPath]
    }

    const candidates = await listBrowserLaunchCandidates(executablePath || this.browserPath)
    if (candidates.length > 0) {
      return candidates
    }

    this.browserPath = null
    throw new Error('未找到可用浏览器，请安装 Edge/Chrome 或重新选择浏览器主程序。')
  }

  private async withLaunchLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.launchQueue
    let release!: () => void
    this.launchQueue = new Promise<void>(resolve => {
      release = resolve
    })

    await previous

    try {
      return await task()
    } finally {
      release()
    }
  }

  private clearSharedHeadlessCloseTimer() {
    if (this.sharedHeadlessCloseTimer) {
      clearTimeout(this.sharedHeadlessCloseTimer)
      this.sharedHeadlessCloseTimer = null
    }
  }

  private resetSharedHeadlessBrowser(browser?: playwright.Browser | null) {
    if (!browser || this.sharedHeadlessBrowser === browser) {
      this.sharedHeadlessBrowser = null
      this.sharedHeadlessRefCount = 0
      this.clearSharedHeadlessCloseTimer()
    }
  }

  private async createBrowser(
    headless = true,
    executablePath?: string,
    options: BrowserLaunchOptions = {},
  ) {
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

    const candidates = await this.resolveBrowserLaunchCandidates(
      executablePath,
      options.allowFallback ?? true,
    )

    const args = buildChromiumLaunchArgs(headless)
    if (headless && shouldDisableChromiumSandbox()) {
      logger.warn(
        '[Browser] Chromium sandbox disabled via PLAYWRIGHT_DISABLE_SANDBOX=true; use only when the host environment requires it',
      )
    }

    let lastErrorMessage = ''
    for (const execPath of candidates) {
      console.log(`[BrowserPopup] [BrowserSessionManager] Browser path: ${execPath}`)
      logger.info(`Launching browser: headless=${headless}, execPath=${execPath}`)

      try {
        console.log('[BrowserPopup] [BrowserSessionManager] Calling chromium.launch()')
        const browser = await this.withLaunchLock(
          async () =>
            await chromium!.launch({
              headless,
              executablePath: execPath,
              args,
            }),
        )
        this.rememberSuccessfulBrowserPath(execPath)
        console.log(
          `[BrowserPopup] [BrowserSessionManager] Browser launched successfully, isConnected: ${browser.isConnected()}`,
        )
        logger.info(`Browser launched successfully: ${execPath}`)
        return browser
      } catch (error) {
        const errorMessage = formatLaunchError(error)
        lastErrorMessage = errorMessage
        console.error(
          `[BrowserPopup] [BrowserSessionManager] chromium.launch() failed: ${errorMessage}`,
        )
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error(`Failed to launch browser (${execPath}): ${errorMessage}`)
        if (errorStack) {
          logger.error(`Stack trace: ${errorStack}`)
        }
        this.clearCachedBrowserPathIfMatched(execPath)
      }
    }

    throw new Error(`浏览器启动失败: ${lastErrorMessage || '所有候选浏览器均无法启动'}`)
  }

  private getPersistentUserDataDir(platform: string, accountId: string) {
    return path.join(
      app.getPath('userData'),
      'browser-profiles',
      sanitizeProfileSegment(platform),
      sanitizeProfileSegment(accountId),
    )
  }

  private async getOrCreateSharedHeadlessBrowser(): Promise<playwright.Browser> {
    this.clearSharedHeadlessCloseTimer()

    if (this.sharedHeadlessBrowser?.isConnected()) {
      return this.sharedHeadlessBrowser
    }

    if (this.sharedHeadlessBrowserPromise) {
      return await this.sharedHeadlessBrowserPromise
    }

    this.sharedHeadlessBrowserPromise = this.createBrowser(true)
      .then(browser => {
        browser.once('disconnected', () => {
          logger.warn('[Browser] Shared headless browser disconnected, cache cleared')
          this.resetSharedHeadlessBrowser(browser)
        })
        this.sharedHeadlessBrowser = browser
        return browser
      })
      .finally(() => {
        this.sharedHeadlessBrowserPromise = null
      })

    return await this.sharedHeadlessBrowserPromise
  }

  private scheduleSharedHeadlessBrowserClose() {
    if (this.sharedHeadlessRefCount > 0 || !this.sharedHeadlessBrowser?.isConnected()) {
      return
    }

    this.clearSharedHeadlessCloseTimer()
    this.sharedHeadlessCloseTimer = setTimeout(() => {
      const browser = this.sharedHeadlessBrowser
      if (!browser || !browser.isConnected() || this.sharedHeadlessRefCount > 0) {
        return
      }

      void browser.close().catch(error => {
        logger.warn('[Browser] Failed to close idle shared headless browser:', error)
      })
    }, SHARED_HEADLESS_BROWSER_IDLE_MS)
  }

  public async releaseSessionBrowser(session: BrowserSession): Promise<void> {
    const { browser, browserOwnership } = session

    if (browserOwnership === 'shared') {
      if (this.sharedHeadlessBrowser === browser && this.sharedHeadlessRefCount > 0) {
        this.sharedHeadlessRefCount -= 1
      }
      this.scheduleSharedHeadlessBrowserClose()
      return
    }

    if (browserOwnership === 'persistent') {
      if (!browser.isConnected()) {
        return
      }
      await browser.close()
      if (browser.isConnected()) {
        throw new Error('浏览器关闭失败：persistent browser.close() 返回后浏览器仍处于连接状态')
      }
      return
    }

    if (!browser.isConnected()) {
      return
    }

    await browser.close()

    if (browser.isConnected()) {
      throw new Error('浏览器关闭失败：browser.close() 返回后浏览器仍处于连接状态')
    }
  }

  public async cleanup(): Promise<void> {
    this.clearSharedHeadlessCloseTimer()

    const browser = this.sharedHeadlessBrowser
    this.sharedHeadlessBrowser = null
    this.sharedHeadlessRefCount = 0

    if (browser?.isConnected()) {
      await browser.close()
    }
  }

  public async createSession(
    headless = true,
    storageState?: StorageState,
  ): Promise<BrowserSession> {
    console.log(
      `[BrowserPopup] [BrowserSessionManager] createSession() called with headless=${headless}`,
    )

    const browser = headless
      ? await this.getOrCreateSharedHeadlessBrowser()
      : await this.createBrowser(false)
    const browserOwnership: BrowserSession['browserOwnership'] = headless ? 'shared' : 'exclusive'

    let context: playwright.BrowserContext | null = null

    try {
      console.log('[BrowserPopup] [BrowserSessionManager] Browser created, creating context...')
      context = await browser.newContext({
        viewport: null,
        storageState,
      })
      console.log('[BrowserPopup] [BrowserSessionManager] Context created, creating page...')
      const page = await context.newPage()
      console.log('[BrowserPopup] [BrowserSessionManager] Page created, session ready')

      if (browserOwnership === 'shared') {
        this.sharedHeadlessRefCount += 1
      }

      return { browser, context, page, browserOwnership, isHeadless: headless }
    } catch (error) {
      await context?.close().catch(closeError => {
        logger.warn(
          '[Browser] Failed to rollback browser context after session init error:',
          closeError,
        )
      })
      if (browserOwnership === 'exclusive' && browser.isConnected()) {
        await browser.close().catch(closeError => {
          logger.warn(
            '[Browser] Failed to rollback exclusive browser after session init error:',
            closeError,
          )
        })
      }
      throw error
    }
  }

  public async createPersistentUserSession(params: {
    platform: string
    accountId: string
  }): Promise<BrowserSession> {
    const { platform, accountId } = params
    console.log(
      `[BrowserPopup] [BrowserSessionManager] createPersistentUserSession() called platform=${platform} accountId=${accountId}`,
    )

    if (!chromium) {
      const errorMsg = 'playwright 运行时未能正确加载，无法启动浏览器'
      console.error('[BrowserPopup] [BrowserSessionManager] chromium is null or undefined')
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    if (typeof chromium.launchPersistentContext !== 'function') {
      const errorMsg = `chromium.launchPersistentContext 不是函数，chromium 类型: ${typeof chromium}, 属性: ${Object.keys(chromium).join(', ')}`
      console.error(
        '[BrowserPopup] [BrowserSessionManager] chromium.launchPersistentContext is not a function',
      )
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    const candidates = await this.resolveBrowserLaunchCandidates()
    const userDataDir = this.getPersistentUserDataDir(platform, accountId)
    const args = buildChromiumUserLaunchArgs()

    let lastErrorMessage = ''
    for (const execPath of candidates) {
      logger.info(
        `[Browser] Launching persistent user browser: platform=${platform}, accountId=${accountId}, execPath=${execPath}, userDataDir=${userDataDir}`,
      )

      try {
        const context = await this.withLaunchLock(
          async () =>
            await chromium!.launchPersistentContext(userDataDir, {
              headless: false,
              viewport: null,
              executablePath: execPath,
              args,
            }),
        )
        const browser = context.browser()
        if (!browser) {
          await context.close().catch(closeError => {
            logger.warn(
              '[Browser] Failed to rollback persistent context without browser:',
              closeError,
            )
          })
          throw new Error('persistent browser context 未返回 browser 实例')
        }

        this.rememberSuccessfulBrowserPath(execPath)
        const page = context.pages()[0] ?? (await context.newPage())
        logger.info(`Persistent user browser launched successfully: ${execPath}`)
        return {
          browser,
          context,
          page,
          browserOwnership: 'persistent',
          isHeadless: false,
          persistentProfileDir: userDataDir,
        }
      } catch (error) {
        const errorMessage = formatLaunchError(error)
        lastErrorMessage = errorMessage
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error(`Failed to launch persistent user browser (${execPath}): ${errorMessage}`)
        if (errorStack) {
          logger.error(`Stack trace: ${errorStack}`)
        }
        this.clearCachedBrowserPathIfMatched(execPath)
      }
    }

    throw new Error(`浏览器启动失败: ${lastErrorMessage || '所有候选浏览器均无法启动'}`)
  }

  public async testBrowserLaunch(browserPath: string): Promise<BrowserTestResult> {
    try {
      const validation = validateBrowserExecutableFile(browserPath)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.reason,
        }
      }

      const browser = await this.createBrowser(true, validation.normalizedPath, {
        allowFallback: false,
      })
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
