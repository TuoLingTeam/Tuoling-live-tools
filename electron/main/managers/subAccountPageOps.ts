import type { Page } from 'playwright'

type LoggerLike = {
  debug: (message: string, error?: unknown) => void
}

type ElementHandleLike = NonNullable<Awaited<ReturnType<Page['$']>>>

export async function findBestSubAccountCommentInput(page: Page, selector: string) {
  const candidates = await page.$$(selector)
  const scored: Array<{
    handle: Awaited<ReturnType<Page['$']>>
    score: number
  }> = []

  for (const handle of candidates) {
    try {
      const visible = await handle.isVisible()
      if (!visible) continue

      const enabled = await handle.isEnabled().catch(() => true)
      if (!enabled) continue

      const box = await handle.boundingBox()
      if (!box) continue

      const meta = await handle.evaluate(el => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLDivElement
        return {
          tagName: input.tagName.toLowerCase(),
          placeholder: input.getAttribute('placeholder') || '',
          contentEditable: input.getAttribute('contenteditable') || '',
        }
      })

      let score = box.y
      if (meta.placeholder.includes('发弹幕') || meta.placeholder.includes('说点什么'))
        score += 2000
      if (meta.contentEditable === 'true') score += 500
      if (meta.tagName === 'textarea' || meta.tagName === 'input') score += 200

      scored.push({ handle, score })
    } catch {
      // ignore detached/invalid candidate
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.handle ?? null
}

export async function findBestSubAccountSendButton(page: Page, selector: string) {
  const candidates = await page.$$(selector)
  const scored: Array<{
    handle: Awaited<ReturnType<Page['$']>>
    score: number
  }> = []

  for (const handle of candidates) {
    try {
      const visible = await handle.isVisible()
      if (!visible) continue

      const enabled = await handle.isEnabled().catch(() => true)
      if (!enabled) continue

      const box = await handle.boundingBox()
      if (!box) continue

      const text = ((await handle.textContent()) || '').trim()
      let score = box.y
      if (text.includes('发送')) score += 1500
      scored.push({ handle, score })
    } catch {
      // ignore detached/invalid candidate
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.handle ?? null
}

export async function fillSubAccountCommentInput(input: ElementHandleLike, message: string) {
  await input.click({ delay: 50 }).catch(() => {})

  const meta = await input.evaluate(el => {
    const node = el as HTMLElement
    return {
      tagName: node.tagName.toLowerCase(),
      isContentEditable: node.isContentEditable,
    }
  })

  if (meta.isContentEditable) {
    await input.evaluate((el, value) => {
      const node = el as HTMLElement
      node.focus()
      node.textContent = ''
      node.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
      )
      node.textContent = value
      node.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }),
      )
    }, message)
    return
  }

  if (meta.tagName === 'input' || meta.tagName === 'textarea') {
    await input.fill(message)
    return
  }

  await input.press('Meta+A').catch(() => {})
  await input.press('Control+A').catch(() => {})
  await input.type(message, { delay: 30 })
}

export async function verifySubAccountCommentSubmitted(
  input: ElementHandleLike,
  message: string,
): Promise<boolean> {
  await new Promise(resolve => setTimeout(resolve, 400))

  const currentValue = await input
    .evaluate(el => {
      const node = el as HTMLInputElement | HTMLTextAreaElement | HTMLElement
      if ('value' in node && typeof node.value === 'string') return node.value
      return node.textContent || ''
    })
    .catch(() => '')

  return currentValue.trim() !== message.trim()
}

export async function detectSubAccountVerificationRequirement(
  page: Page,
  logger: LoggerLike,
): Promise<string | null> {
  try {
    const result = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
      const title = document.title || ''
      const href = location.href
      const keywords = [
        '拖动滑块',
        '滑块验证',
        '请完成验证',
        '安全验证',
        '行为验证',
        '请在下方完成验证',
        '向右拖动滑块',
        '拼图验证',
        '验证码',
      ]

      const matchedKeyword = keywords.find(
        keyword => bodyText.includes(keyword) || title.includes(keyword),
      )
      const riskElement = document.querySelector(
        [
          '[class*="captcha"]',
          '[id*="captcha"]',
          '[class*="verify"]',
          '[id*="verify"]',
          '[class*="secsdk"]',
          '[id*="secsdk"]',
          'iframe[src*="captcha"]',
          'iframe[src*="verify"]',
          'iframe[src*="secsdk"]',
        ].join(','),
      )

      return {
        matchedKeyword: matchedKeyword || null,
        hasRiskElement: !!riskElement,
        href,
      }
    })

    const riskyUrl =
      result.href.includes('captcha') ||
      result.href.includes('verify') ||
      result.href.includes('secsdk')

    if (!result.matchedKeyword && !result.hasRiskElement && !riskyUrl) {
      return null
    }

    if (result.matchedKeyword) {
      return `检测到平台安全验证（${result.matchedKeyword}），请先在浏览器完成验证后再重新启动任务`
    }

    return '检测到平台安全验证，请先在浏览器完成滑块或验证码后再重新启动任务'
  } catch (error) {
    logger.debug('检测安全验证状态失败：', error)
    return null
  }
}
