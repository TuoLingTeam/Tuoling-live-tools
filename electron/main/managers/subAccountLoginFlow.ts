import type { BrowserContext, Page } from 'playwright'
import type { createLogger } from '#/logger'
import type { StorageState } from '#/managers/BrowserSessionManager'

type SessionLogger = ReturnType<typeof createLogger>

type SubAccountStatus = 'idle' | 'connecting' | 'connected' | 'error'

type LoginPollingSession = {
  id: string
  name: string
  status: SubAccountStatus
  error?: string
  page?: Page
  context?: BrowserContext
}

type InitialLoginResolution =
  | { state: 'connected' }
  | { state: 'waiting_verification'; message: string }

async function isSubAccountLoggedIn(page: Page, loggedInSelector: string) {
  return await page
    .$(loggedInSelector)
    .then(el => !!el)
    .catch(() => false)
}

export async function resolveSubAccountInitialLogin(params: {
  page: Page
  loggedInSelector: string
  sessionName: string
  logger: SessionLogger
}): Promise<InitialLoginResolution> {
  const { page, loggedInSelector, sessionName, logger } = params

  const isAlreadyLoggedIn = await isSubAccountLoggedIn(page, loggedInSelector)
  if (isAlreadyLoggedIn) {
    logger.info(`小号 ${sessionName} 已登录`)
    return { state: 'connected' }
  }

  logger.info(`小号 ${sessionName} 等待用户登录（支持二次验证）...`)

  const quickLoginSuccess = await page
    .waitForSelector(loggedInSelector, { timeout: 30000 })
    .then(() => true)
    .catch(() => false)

  if (quickLoginSuccess) {
    logger.success(`小号 ${sessionName} 登录成功`)
    return { state: 'connected' }
  }

  const currentUrl = page.url()
  const pageTitle = await page.title().catch(() => '')

  logger.info(`小号 ${sessionName} 当前 URL: ${currentUrl}`)
  logger.info(`小号 ${sessionName} 当前标题：${pageTitle}`)

  const recheckLoggedIn = await isSubAccountLoggedIn(page, loggedInSelector)
  const isOnMainPage =
    !currentUrl.includes('login') &&
    !currentUrl.includes('passport') &&
    !currentUrl.includes('signin') &&
    !currentUrl.includes('auth') &&
    (currentUrl.startsWith('https://www.douyin.com/') ||
      currentUrl.startsWith('https://www.xiaohongshu.com/') ||
      currentUrl.startsWith('https://www.kuaishou.com/') ||
      currentUrl.startsWith('https://www.taobao.com/') ||
      currentUrl.includes('weixin.qq.com'))

  const hasLoginButton = await page
    .$('button[class*="login"], [class*="login-button"], [data-e2e="login-button"]')
    .then(el => !!el)
    .catch(() => false)

  const isActuallyLoggedIn = recheckLoggedIn || (isOnMainPage && !hasLoginButton)

  logger.info(
    `小号 ${sessionName} 登录检测结果：loggedInSelector=${recheckLoggedIn}, isOnMainPage=${isOnMainPage}, hasLoginButton=${hasLoginButton}`,
  )

  if (isActuallyLoggedIn) {
    logger.success(`小号 ${sessionName} 检测到已登录（页面已跳转到首页）`)
    return { state: 'connected' }
  }

  const isInLoginFlow =
    currentUrl.includes('login') ||
    currentUrl.includes('auth') ||
    currentUrl.includes('passport') ||
    currentUrl.includes('signin') ||
    pageTitle.includes('登录') ||
    pageTitle.includes('Login')

  logger.info(`小号 ${sessionName} 是否在登录流程中：${isInLoginFlow}`)

  if (isInLoginFlow) {
    logger.warn(`小号 ${sessionName} 可能需要二次验证，启动后台轮询检测...`)
    return {
      state: 'waiting_verification',
      message: '等待二次验证，请在浏览器中完成验证',
    }
  }

  throw new Error('登录超时，请检查网络或账号状态')
}

export function stopSubAccountLoginPolling(params: {
  accountId: string
  loginPollTimers: Map<string, NodeJS.Timeout>
  logger: SessionLogger
}) {
  const { accountId, loginPollTimers, logger } = params
  const timer = loginPollTimers.get(accountId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  loginPollTimers.delete(accountId)
  logger.info(`小号 ${accountId} 登录轮询已停止`)
}

export function startSubAccountLoginPolling<TSession extends LoginPollingSession>(params: {
  session: TSession
  loggedInSelector: string
  loginPollTimers: Map<string, NodeJS.Timeout>
  logger: SessionLogger
  notifyStatusChange: (accountId: string, status: SubAccountStatus, error?: string) => void
  persistStorageState: (session: TSession, storageState: StorageState | string) => void
  cleanupSession: (session: TSession) => Promise<void>
}) {
  const {
    session,
    loggedInSelector,
    loginPollTimers,
    logger,
    notifyStatusChange,
    persistStorageState,
    cleanupSession,
  } = params

  stopSubAccountLoginPolling({
    accountId: session.id,
    loginPollTimers,
    logger,
  })

  const POLL_INTERVAL = 3000
  const MAX_POLL_TIME = 5 * 60 * 1000
  let pollCount = 0
  const maxPolls = MAX_POLL_TIME / POLL_INTERVAL

  const poll = async () => {
    if (session.status !== 'connecting') {
      logger.info(`小号 ${session.name} 状态已改变，停止轮询`)
      stopSubAccountLoginPolling({
        accountId: session.id,
        loginPollTimers,
        logger,
      })
      return
    }

    pollCount++
    if (pollCount > maxPolls) {
      logger.warn(`小号 ${session.name} 登录轮询超时`)
      session.status = 'error'
      session.error = '登录验证超时，请重新尝试'
      notifyStatusChange(session.id, 'error', '登录验证超时，请重新尝试')
      await cleanupSession(session)
      stopSubAccountLoginPolling({
        accountId: session.id,
        loginPollTimers,
        logger,
      })
      return
    }

    try {
      if (!session.page || session.page.isClosed()) {
        logger.warn(`小号 ${session.name} 页面已关闭，停止轮询`)
        session.status = 'error'
        session.error = '登录页面已关闭'
        notifyStatusChange(session.id, 'error', '登录页面已关闭')
        stopSubAccountLoginPolling({
          accountId: session.id,
          loginPollTimers,
          logger,
        })
        return
      }

      const isLoggedIn = await isSubAccountLoggedIn(session.page, loggedInSelector)

      if (isLoggedIn) {
        logger.success(`小号 ${session.name} 轮询检测到登录成功`)
        session.status = 'connected'
        session.error = undefined

        try {
          const newStorageState = session.context ? await session.context.storageState() : undefined
          if (newStorageState) {
            persistStorageState(session, newStorageState)
          }
          logger.info(`小号 ${session.name} 登录状态已保存`)
        } catch (error) {
          logger.warn(`小号 ${session.name} 保存登录状态失败:`, error)
        }

        notifyStatusChange(session.id, 'connected')
        logger.success(`小号连接成功：${session.name}（观众身份），已停止轮询`)
        stopSubAccountLoginPolling({
          accountId: session.id,
          loginPollTimers,
          logger,
        })
        return
      }

      const timer = setTimeout(poll, POLL_INTERVAL)
      loginPollTimers.set(session.id, timer)
    } catch (error) {
      logger.error(`小号 ${session.name} 轮询检测出错:`, error)
      const timer = setTimeout(poll, POLL_INTERVAL)
      loginPollTimers.set(session.id, timer)
    }
  }

  const timer = setTimeout(poll, POLL_INTERVAL)
  loginPollTimers.set(session.id, timer)
  logger.info(`小号 ${session.name} 启动登录状态轮询检测`)
}
