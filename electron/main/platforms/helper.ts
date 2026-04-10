import { Result } from '@praha/byethrow'
import type { ElementHandle, Page } from 'playwright'
import { UnexpectedError } from '#/errors/AppError'
import {
  ElementContentMismatchedError,
  ElementDisabledError,
  ElementNotFoundError,
  MaxTryCountExceededError,
  PageNotFoundError,
  type PlatformError,
} from '#/errors/PlatformError'
import { abortableSleep, sleep } from '#/utils'
import type { IElementFinder } from './IElementFinder'

const CONNECT_TIMEOUT_MS = 3 * 60 * 1000
const SCROLL_WAIT_TIMEOUT_MS = 1500
const SCROLL_POLL_INTERVAL_MS = 100
const SCROLL_PROGRESS_TOLERANCE = 4

async function waitForScrollProgress(
  scrollContainer: ElementHandle<SVGElement | HTMLElement>,
  previousScrollTop: number,
  timeoutMs = SCROLL_WAIT_TIMEOUT_MS,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let currentScrollTop = await scrollContainer.evaluate(el => el.scrollTop)

  while (Date.now() < deadline) {
    if (
      Number.isNaN(previousScrollTop) ||
      Math.abs(currentScrollTop - previousScrollTop) > SCROLL_PROGRESS_TOLERANCE
    ) {
      return currentScrollTop
    }
    await sleep(SCROLL_POLL_INTERVAL_MS)
    currentScrollTop = await scrollContainer.evaluate(el => el.scrollTop)
  }

  return currentScrollTop
}

async function waitForPageSettled(page: Page, timeoutMs = 3000): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs })
    return
  } catch {
    // ignore and fall back to the lighter readiness signal below
  }

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
  } catch {
    // 页面已打开但仍未稳定时，不阻塞主流程。
  }
}

export async function connect(
  page: Page,
  loginConstants: {
    liveControlUrl: string
    loginUrlRegex: RegExp
    isInLiveControlSelector: string
  },
) {
  await page.goto(loginConstants.liveControlUrl, {
    waitUntil: 'domcontentloaded',
  })
  await Promise.race([
    page.waitForURL(loginConstants.loginUrlRegex, {
      timeout: CONNECT_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    }),
    page.waitForSelector(loginConstants.isInLiveControlSelector, {
      timeout: CONNECT_TIMEOUT_MS,
    }),
  ])

  const isConnected = !loginConstants.loginUrlRegex.test(page.url())
  return isConnected
}

export async function getAccountName(page: Page, accountNameSelector: string) {
  return page.waitForSelector(accountNameSelector).then(el => el.textContent())
}

export async function comment(
  page: Page,
  elementFinder: IElementFinder,
  message: string,
  pinTop?: boolean,
): Result.ResultAsync<boolean, PlatformError> {
  async function clickPinTopButton(page: Page): Result.ResultAsync<boolean, PlatformError> {
    return Result.pipe(
      elementFinder.getPinTopLabel(page),
      Result.inspect(label => label.dispatchEvent('click')),
      Result.map(_ => true),
      // 即使没有 pinTop 也不会中断程序
      Result.orElse(_ => Result.succeed(false)),
    )
  }

  return Result.pipe(
    // 评论框
    elementFinder.getCommentTextarea(page),
    // 填写评论内容
    Result.inspect(textarea => textarea.fill(message, { timeout: 5000 })),
    // 点击置顶选项
    Result.andThen(_ => (pinTop ? clickPinTopButton(page) : Result.succeed(false))),
    // 发送评论
    Result.andThrough(_ =>
      Result.pipe(
        elementFinder.getClickableSubmitCommentButton(page),
        Result.inspect(btn => btn.dispatchEvent('click')),
      ),
    ),
  )
}

/** 在虚拟列表中找到目标序号的位置 */
export async function getItemFromVirtualScroller(
  page: Page,
  elementFinder: IElementFinder,
  targetId: number,
  maxRetries = 10,
): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
  const SCROLL_TOLERANCE = 10

  /**
   * 在当前渲染的DOM节点中查找具有特定ID的商品。
   */
  async function findItemInCurrentView(id: number) {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }
    try {
      // 并发执行，效率比顺序遍历快了10倍以上
      const foundItem = await Promise.any(
        currentGoodsItems.value.map(async goodsItem => {
          const itemIdResult = await elementFinder.getIdFromGoodsItem(goodsItem)
          if (Result.isSuccess(itemIdResult) && itemIdResult.value === id) {
            return goodsItem
          }
          throw new Error('未匹配')
        }),
      )
      return Result.succeed(foundItem)
    } catch (err) {
      // Promise.any 全部出错抛出的错误为 AggregateError
      // 表示全部都未找到
      if (err instanceof AggregateError) {
        return Result.succeed(null)
      }
      return Result.fail(new UnexpectedError({ cause: err }))
    }
  }

  /**
   * 根据目标ID和当前列表的ID范围，决定下一个滚动的锚点元素（列表的第一个或最后一个）。
   */
  async function determineScrollTarget(
    id: number,
  ): Result.ResultAsync<ElementHandle<SVGElement | HTMLElement>, PlatformError> {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }

    const firstItem = currentGoodsItems.value[0]
    const lastItem = currentGoodsItems.value[currentGoodsItems.value.length - 1]

    return Result.pipe(
      Result.sequence([
        elementFinder.getIdFromGoodsItem(firstItem),
        elementFinder.getIdFromGoodsItem(lastItem),
      ]),
      Result.andThen(([firstId, lastId]) => {
        // 判断列表是正序还是倒序
        const isReversed = firstId > lastId
        // logger.warn(`商品 ${id} 不在当前范围 [${firstId} ~ ${lastId}]，继续滚动查找...`);
        // 目标ID小于当前范围的起始ID (正序) 或 大于 (倒序)，需要向上滚
        if ((!isReversed && id < firstId) || (isReversed && id > firstId)) {
          return Result.succeed(firstItem)
        }
        // 否则，向下滚
        return Result.succeed(lastItem)
      }),
    )
  }

  /**
   * 等待列表加载新内容。
   */
  async function waitForNewItemsToLoad(
    scrollContainer: ElementHandle<SVGElement | HTMLElement>,
    previousScrollTop: number,
  ) {
    return waitForScrollProgress(scrollContainer, previousScrollTop)
  }

  let lastScrollTop = Number.NaN
  let retries = 0

  while (retries < maxRetries) {
    // 1. 在当前视图中查找
    const foundItem = await findItemInCurrentView(targetId)
    if (Result.isFailure(foundItem)) {
      return foundItem
    }
    if (foundItem.value) {
      return Result.succeed(foundItem.value)
    }

    // 1. 先找到目标点并滚动
    const scrollTarget = await determineScrollTarget(targetId)
    if (Result.isFailure(scrollTarget)) {
      return scrollTarget
    }
    await scrollTarget.value.scrollIntoViewIfNeeded({ timeout: 5000 })
    const scrollContainer = await elementFinder.getGoodsItemsScrollContainer(page)
    if (Result.isFailure(scrollContainer)) {
      return scrollContainer
    }
    const currentScrollTop = await waitForNewItemsToLoad(scrollContainer.value, lastScrollTop)

    // 3. 检查是否滚动到底了 (终止条件)
    if (
      !Number.isNaN(lastScrollTop) &&
      Math.abs(lastScrollTop - currentScrollTop) <= SCROLL_TOLERANCE
    ) {
      // logger.debug(`滚动位置未改变，无法找到更多内容。ScrollTop: ${currentScrollTop}`);
      return Result.fail(
        new ElementNotFoundError({
          elementName: `id为${targetId}的商品`,
        }),
      )
    }
    lastScrollTop = currentScrollTop

    retries++
  }

  return Result.fail(
    new MaxTryCountExceededError({
      taskName: '查找商品',
      maxTryCount: maxRetries,
    }),
  )
}

/** 读取当前商品列表中的全部商品序号，兼容虚拟列表和普通列表。 */
export async function getAllGoodsIdsFromScroller(
  page: Page,
  elementFinder: IElementFinder,
  maxScrollPasses = 30,
): Result.ResultAsync<number[], PlatformError> {
  const SCROLL_TOLERANCE = 10
  const seenGoodsIds = new Set<number>()
  let lastScrollTop = Number.NaN

  for (let pass = 0; pass < maxScrollPasses; pass++) {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }

    const currentIdResults = await Promise.all(
      currentGoodsItems.value.map(item => elementFinder.getIdFromGoodsItem(item)),
    )

    for (const idResult of currentIdResults) {
      if (Result.isSuccess(idResult)) {
        seenGoodsIds.add(idResult.value)
      }
    }

    const scrollContainer = await elementFinder.getGoodsItemsScrollContainer(page)
    if (Result.isFailure(scrollContainer)) {
      if (seenGoodsIds.size > 0) {
        return Result.succeed([...seenGoodsIds].sort((a, b) => a - b))
      }
      return scrollContainer
    }

    const lastItem = currentGoodsItems.value[currentGoodsItems.value.length - 1]
    await lastItem.scrollIntoViewIfNeeded({ timeout: 5000 })
    const currentScrollTop = await waitForScrollProgress(scrollContainer.value, lastScrollTop)
    if (
      !Number.isNaN(lastScrollTop) &&
      Math.abs(lastScrollTop - currentScrollTop) <= SCROLL_TOLERANCE
    ) {
      break
    }
    lastScrollTop = currentScrollTop
  }

  if (seenGoodsIds.size === 0) {
    return Result.fail(
      new ElementNotFoundError({
        elementName: '商品列表',
      }),
    )
  }

  return Result.succeed([...seenGoodsIds].sort((a, b) => a - b))
}

export async function getAllGoodsMetaFromScroller(
  page: Page,
  elementFinder: IElementFinder,
  maxScrollPasses = 30,
): Result.ResultAsync<Array<{ id: number; title?: string }>, PlatformError> {
  const SCROLL_TOLERANCE = 10
  const seenGoods = new Map<number, { id: number; title?: string }>()
  let lastScrollTop = Number.NaN

  for (let pass = 0; pass < maxScrollPasses; pass++) {
    const currentGoodsItems = await elementFinder.getCurrentGoodsItemsList(page)
    if (Result.isFailure(currentGoodsItems)) {
      return currentGoodsItems
    }

    for (const item of currentGoodsItems.value) {
      const idResult = await elementFinder.getIdFromGoodsItem(item)
      if (Result.isFailure(idResult)) continue

      const titleResult = elementFinder.getTitleFromGoodsItem
        ? await elementFinder.getTitleFromGoodsItem(item)
        : Result.succeed(undefined)

      const previous = seenGoods.get(idResult.value)
      seenGoods.set(idResult.value, {
        id: idResult.value,
        title: (Result.isSuccess(titleResult) ? titleResult.value : undefined) || previous?.title,
      })
    }

    const scrollContainer = await elementFinder.getGoodsItemsScrollContainer(page)
    if (Result.isFailure(scrollContainer)) {
      if (seenGoods.size > 0) {
        return Result.succeed([...seenGoods.values()].sort((a, b) => a.id - b.id))
      }
      return scrollContainer
    }

    const lastItem = currentGoodsItems.value[currentGoodsItems.value.length - 1]
    await lastItem.scrollIntoViewIfNeeded({ timeout: 5000 })
    const currentScrollTop = await waitForScrollProgress(scrollContainer.value, lastScrollTop)
    if (
      !Number.isNaN(lastScrollTop) &&
      Math.abs(lastScrollTop - currentScrollTop) <= SCROLL_TOLERANCE
    ) {
      break
    }
    lastScrollTop = currentScrollTop
  }

  if (seenGoods.size === 0) {
    return Result.fail(
      new ElementNotFoundError({
        elementName: '商品列表',
      }),
    )
  }

  return Result.succeed([...seenGoods.values()].sort((a, b) => a.id - b.id))
}

export async function scanGoodsKnowledgeFromItem(
  page: Page,
  item: ElementHandle<SVGElement | HTMLElement>,
  elementFinder: IElementFinder,
  goodsId: number,
): Result.ResultAsync<
  {
    id: number
    title?: string
    priceText?: string
    detailText?: string
    source: 'detail-page' | 'list-item'
  },
  PlatformError | Error
> {
  const titleResult = elementFinder.getTitleFromGoodsItem
    ? await elementFinder.getTitleFromGoodsItem(item)
    : Result.succeed(undefined)

  const listText = await item.evaluate(el => (el as HTMLElement).innerText || '')
  const fallbackTitle = Result.isSuccess(titleResult) ? titleResult.value : undefined
  const fallbackPrice = listText.match(/[¥￥]\s*\d+(?:\.\d+)?/)?.[0]

  const href = await item.evaluate(el => {
    const anchor = el.querySelector('a[href]') as HTMLAnchorElement | null
    return anchor?.href || null
  })

  if (!href) {
    return Result.succeed({
      id: goodsId,
      title: fallbackTitle,
      priceText: fallbackPrice,
      detailText: listText.trim() || undefined,
      source: 'list-item',
    })
  }

  const context = page.context()
  const detailPage = await context.newPage()
  try {
    await detailPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await waitForPageSettled(detailPage)
    const detailTitle = await detailPage.title().catch(() => '')
    const detailText = await detailPage.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return text.slice(0, 5000)
    })
    const detailPrice = detailText.match(/[¥￥]\s*\d+(?:\.\d+)?/)?.[0]

    return Result.succeed({
      id: goodsId,
      title: detailTitle || fallbackTitle,
      priceText: detailPrice || fallbackPrice,
      detailText: detailText.trim() || listText.trim() || undefined,
      source: 'detail-page',
    })
  } finally {
    await detailPage.close().catch(() => {})
  }
}

const TOGGLE_BUTTON_MAX_TRY_COUNT = 5
export async function toggleButton(
  button: ElementHandle<SVGElement | HTMLElement>,
  sourceContent: string,
  targetContent: string,
  signal?: AbortSignal,
  tryCount = 0,
): Result.ResultAsync<void, Error> {
  if (tryCount > TOGGLE_BUTTON_MAX_TRY_COUNT) {
    return Result.fail(
      new MaxTryCountExceededError({
        taskName: 'toggleButton',
        maxTryCount: TOGGLE_BUTTON_MAX_TRY_COUNT,
      }),
    )
  }
  const buttonText = (await button.textContent())?.trim() || ''
  if (buttonText !== sourceContent && buttonText !== targetContent) {
    return Result.fail(
      new ElementContentMismatchedError({
        current: buttonText,
        target: `${targetContent} 或 ${sourceContent}`,
      }),
    )
  }

  // 两种情况：
  // 1. 商品未讲解：buttonText === sourceContent，点击变为 targetContent 即可
  // 2. 商品正在讲解：需要先点击一次取消讲解，变为未讲解状态
  if (buttonText === targetContent && tryCount > 0) {
    return Result.succeed()
  }
  if (await button.isDisabled()) {
    return Result.fail(
      new ElementDisabledError({
        elementName: '讲解按钮',
        element: await button.evaluate(el => el.outerHTML),
      }),
    )
  }
  // button.click() 在抖店&百应的表现很诡异，所以用 dispatchEvent('click')
  await button.dispatchEvent('click')
  return Result.pipe(
    abortableSleep(1000, signal),
    Result.andThen(() => toggleButton(button, sourceContent, targetContent, signal, tryCount + 1)),
  )
}

/** 确保 page 非空 */
export function ensurePage(page: Page | null | undefined): Result.Result<Page, PlatformError> {
  if (!page) {
    return Result.fail(new PageNotFoundError())
  }
  return Result.succeed(page)
}

/** 通过 \<a\> 的点击打开新网页，主要是防止部分反爬的行为 */
export async function openUrlByElement(page: Page, url: string) {
  const context = page.context()
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(url => {
      const el = document.createElement('a')
      el.href = url
      el.target = '_blank'
      el.click()
    }, url),
  ])
  return newPage
}
