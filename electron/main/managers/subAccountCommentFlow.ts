import { Result } from '@praha/byethrow'
import type { createLogger } from '#/logger'
import {
  detectSubAccountVerificationRequirement,
  fillSubAccountCommentInput,
  findBestSubAccountCommentInput,
  findBestSubAccountSendButton,
  verifySubAccountCommentSubmitted,
} from './subAccountPageOps'

type SessionLogger = ReturnType<typeof createLogger>

type CommentSession = {
  id: string
  name: string
  platform: LiveControlPlatform
  page?: import('playwright').Page
  liveRoomUrl?: string
  liveRoomStatus: 'idle' | 'entering' | 'entered' | 'error'
  lastEnterError?: string
  stats: {
    totalSent: number
    successCount: number
    failCount: number
    lastSendTime?: number
    lastError?: string
  }
}

export async function withSubAccountSendLock<T>(params: {
  accountId: string
  sendLocks: Map<string, Promise<void>>
  logger: SessionLogger
  task: () => Promise<T>
}) {
  const { accountId, sendLocks, logger, task } = params
  const prevLock = sendLocks.get(accountId) ?? Promise.resolve()

  let lockReleased = false
  let resolveNext: (() => void) | undefined
  const nextLock = new Promise<void>(resolve => {
    resolveNext = resolve
  })
  const currentLockPromise = prevLock.then(() => nextLock)
  sendLocks.set(accountId, currentLockPromise)

  const releaseLock = () => {
    if (!lockReleased) {
      lockReleased = true
      if (sendLocks.get(accountId) === currentLockPromise) {
        sendLocks.delete(accountId)
      }
    }
  }

  await prevLock
  try {
    return await task()
  } finally {
    releaseLock()
    if (resolveNext) {
      try {
        resolveNext()
      } catch (error) {
        logger.error(`释放发送锁失败：${accountId}`, error)
      }
    }
  }
}

export async function sendSubAccountComment<TSession extends CommentSession>(params: {
  session: TSession
  message: string
  logger: SessionLogger
  getLiveRoomSelectors: (platform: LiveControlPlatform) => {
    inputSelector: string
    sendButtonSelector: string
    sendMethod: 'click' | 'enter'
  }
  createVerificationError: (message: string) => Error
}) {
  const { session, message, logger, getLiveRoomSelectors, createVerificationError } = params
  const page = session.page

  if (!page) {
    return Result.fail(new Error('小号未连接'))
  }

  const selectors = getLiveRoomSelectors(session.platform)

  try {
    session.stats.totalSent++

    if (page.isClosed()) {
      session.stats.failCount++
      session.stats.lastError = '浏览器页面已关闭'
      session.stats.lastSendTime = Date.now()
      session.liveRoomStatus = 'error'
      session.lastEnterError = '浏览器页面已关闭'
      session.liveRoomUrl = undefined
      return Result.fail(new Error('浏览器页面已关闭'))
    }

    const verificationBeforeSend = await detectSubAccountVerificationRequirement(page, logger)
    if (verificationBeforeSend) {
      session.stats.failCount++
      session.stats.lastError = verificationBeforeSend
      session.stats.lastSendTime = Date.now()
      return Result.fail(createVerificationError(verificationBeforeSend))
    }

    const input = await findBestSubAccountCommentInput(page, selectors.inputSelector)
    if (!input) {
      const verificationMessage = await detectSubAccountVerificationRequirement(page, logger)
      if (verificationMessage) {
        session.stats.failCount++
        session.stats.lastError = verificationMessage
        session.stats.lastSendTime = Date.now()
        return Result.fail(createVerificationError(verificationMessage))
      }

      session.stats.failCount++
      session.stats.lastError = '未找到评论输入框'
      session.stats.lastSendTime = Date.now()
      session.liveRoomUrl = undefined
      session.liveRoomStatus = 'error'
      session.lastEnterError = '未找到评论输入框'
      logger.warn(`小号 ${session.name} 未找到评论输入框，selector=${selectors.inputSelector}`)
      return Result.fail(new Error('未找到评论输入框'))
    }

    await fillSubAccountCommentInput(input, message)

    if (selectors.sendMethod === 'click') {
      const sendButton = await findBestSubAccountSendButton(page, selectors.sendButtonSelector)
      if (sendButton) {
        await sendButton.click()
      } else {
        logger.warn(
          `小号 ${session.name} 未找到发送按钮，尝试按回车，selector=${selectors.sendButtonSelector}`,
        )
        await input.press('Enter')
      }
    } else {
      await input.press('Enter')
    }

    const sent = await verifySubAccountCommentSubmitted(input, message)
    if (!sent) {
      logger.warn(`小号 ${session.name} 首次发送后输入框仍保留原内容，尝试回车补发`)
      await input.press('Enter').catch(() => {})
      const retriedSent = await verifySubAccountCommentSubmitted(input, message)
      if (!retriedSent) {
        const verificationMessage = await detectSubAccountVerificationRequirement(page, logger)
        if (verificationMessage) {
          session.stats.failCount++
          session.stats.lastError = verificationMessage
          session.stats.lastSendTime = Date.now()
          return Result.fail(createVerificationError(verificationMessage))
        }

        session.stats.failCount++
        session.stats.lastError = '评论疑似未实际发出'
        session.stats.lastSendTime = Date.now()
        return Result.fail(new Error('评论疑似未实际发出'))
      }
    }

    session.stats.successCount++
    session.stats.lastSendTime = Date.now()
    logger.success(
      `小号 ${session.name} 发送评论：${message} (成功${session.stats.successCount}/总计${session.stats.totalSent})`,
    )
    return Result.succeed(true)
  } catch (error) {
    session.stats.failCount++
    session.stats.lastError = error instanceof Error ? error.message : '发送失败'
    session.stats.lastSendTime = Date.now()
    logger.error(`小号 ${session.name} 发送评论失败`, error)
    return Result.fail(error instanceof Error ? error : new Error('发送失败'))
  }
}
