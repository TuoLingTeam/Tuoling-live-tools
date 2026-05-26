import { afterEach, describe, expect, it, vi } from 'vitest'
import { SELECTORS, URLS } from '../constant'
import { TaobaoPlatform } from '../index'

const sleepMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('#/utils', () => ({
  abortableSleep: vi.fn(),
  sleep: sleepMock,
}))

class FakeElement {
  constructor(
    public readonly textContent: string,
    private readonly attrs: Record<string, string> = {},
  ) {}

  getAttribute(name: string) {
    return this.attrs[name] ?? null
  }
}

class FakeTaobaoPage {
  currentUrl = 'about:blank'
  controlReady = true
  overlayRemainingChecks = 0
  readonly elements = new Map<string, FakeElement[]>()

  readonly goto = vi.fn(async (url: string) => {
    this.currentUrl = url
  })

  readonly waitForURL = vi.fn(() => new Promise(() => {}))

  readonly waitForSelector = vi.fn(async (selector: string) => {
    if (selector === SELECTORS.IN_LIVE_LIST) {
      return {}
    }

    if (selector === SELECTORS.overlays.DRIVER) {
      if (this.overlayRemainingChecks > 0) {
        return {}
      }
      throw new Error('selector not found')
    }

    if (selector.includes(SELECTORS.commentInput.TEXTAREA)) {
      if (this.controlReady) {
        return {}
      }
      throw new Error('selector not found')
    }

    if ((this.elements.get(selector) ?? []).length > 0) {
      return {}
    }

    throw new Error('selector not found')
  })

  readonly $$eval = vi.fn(
    async (selector: string, pageFunction: (elements: FakeElement[]) => any) =>
      pageFunction(this.elements.get(selector) ?? []),
  )

  readonly $ = vi.fn(async (selector: string) => {
    if (selector === SELECTORS.overlays.DRIVER && this.overlayRemainingChecks > 0) {
      return {}
    }
    return null
  })

  readonly press = vi.fn(async () => {
    this.overlayRemainingChecks = Math.max(0, this.overlayRemainingChecks - 1)
  })

  readonly waitForLoadState = vi.fn(async () => undefined)

  readonly url = vi.fn(() => this.currentUrl)

  setLiveId(liveId: string) {
    this.elements.set(
      SELECTORS.LIVE_ID,
      liveId.split('').map(digit => new FakeElement(digit)),
    )
  }
}

function createSession(page: FakeTaobaoPage) {
  return {
    page,
  } as never
}

describe('TaobaoPlatform.connect', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sleepMock.mockReset()
    sleepMock.mockResolvedValue(undefined)
  })

  it('enters the live control page and waits for core controls before reporting connected', async () => {
    const page = new FakeTaobaoPage()
    page.setLiveId('567029524873')
    const platform = new TaobaoPlatform()

    await expect(platform.connect(createSession(page))).resolves.toBe(true)

    expect(page.goto).toHaveBeenNthCalledWith(1, URLS.LIVE_LIST, {
      waitUntil: 'domcontentloaded',
    })
    expect(page.goto).toHaveBeenNthCalledWith(2, `${URLS.LIVE_CONTROL_WITH_ID}567029524873`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    expect(page.waitForSelector).toHaveBeenCalledWith(expect.stringContaining('#comment-page'), {
      timeout: 30_000,
    })
  })

  it('throws a clear no-live error when no online live id can be found', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    sleepMock.mockImplementation(async (ms = 0) => {
      now += ms
    })

    const platform = new TaobaoPlatform()

    await expect(platform.connect(createSession(new FakeTaobaoPage()))).rejects.toThrow(
      '未检测到正在直播的淘宝直播间',
    )
  })

  it('does not loop forever when the Taobao guide overlay cannot be dismissed', async () => {
    const page = new FakeTaobaoPage()
    page.setLiveId('567029524873')
    page.overlayRemainingChecks = 99
    const platform = new TaobaoPlatform()

    await expect(platform.connect(createSession(page))).rejects.toThrow(
      '淘宝直播中控台引导遮罩未关闭',
    )
    expect(page.press).toHaveBeenCalledTimes(8)
  })

  it('fails with a control-ready error when the control page opens but core controls never appear', async () => {
    const page = new FakeTaobaoPage()
    page.setLiveId('567029524873')
    page.controlReady = false
    const platform = new TaobaoPlatform()

    await expect(platform.connect(createSession(page))).rejects.toThrow('淘宝直播中控台加载超时')
  })
})
