import { Result } from '@praha/byethrow'
import { describe, expect, it, vi } from 'vitest'
import { comment, getAllGoodsMetaFromScroller } from '../helper'
import type { IElementFinder } from '../IElementFinder'

vi.mock('#/utils', () => ({
  abortableSleep: vi.fn().mockResolvedValue(Result.succeed()),
  sleep: vi.fn().mockResolvedValue(undefined),
}))

class FakeScrollContainer {
  public scrollTop = 0
  public readonly clientHeight = 1000
  public readonly itemHeight = 100

  constructor(public readonly totalCount: number) {}

  get scrollHeight() {
    return this.totalCount * this.itemHeight
  }

  get maxScrollTop() {
    return Math.max(this.scrollHeight - this.clientHeight, 0)
  }

  scrollTo(options: ScrollToOptions) {
    this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.maxScrollTop))
  }

  dispatchEvent() {
    return true
  }

  async evaluate<T, A>(pageFunction: (element: FakeScrollContainer, arg: A) => T, arg?: A) {
    return pageFunction(this, arg as A)
  }
}

class FakeGoodsItem {
  constructor(
    public readonly id: number,
    public readonly title: string,
    private readonly scroller: FakeScrollContainer,
  ) {}

  async evaluate<T, A>(pageFunction: (element: { innerText: string }, arg: A) => T, arg?: A) {
    return pageFunction({ innerText: `#${this.id}\n${this.title}` }, arg as A)
  }

  async scrollIntoViewIfNeeded() {
    this.scroller.scrollTo({ top: (this.id - 1) * this.scroller.itemHeight })
  }
}

class FakeCommentTextarea {
  public value = ''
  public readonly fill = vi.fn(async (value: string) => {
    this.value = value
  })
  public readonly inputValue = vi.fn(async () => this.value)
}

class FakeCommentButton {
  public readonly dispatchEvent = vi.fn()

  constructor(private readonly onClick: () => void = () => {}) {}

  public readonly click = vi.fn(async () => {
    this.onClick()
  })
}

function renderVisibleItems(scroller: FakeScrollContainer) {
  const firstIndex = Math.floor(scroller.scrollTop / scroller.itemHeight)
  const visibleCount = Math.ceil(scroller.clientHeight / scroller.itemHeight) + 2
  const lastIndex = Math.min(scroller.totalCount, firstIndex + visibleCount)

  return Array.from(
    { length: lastIndex - firstIndex },
    (_, offset) =>
      new FakeGoodsItem(firstIndex + offset + 1, `商品 ${firstIndex + offset + 1}`, scroller),
  )
}

function createElementFinder(scroller: FakeScrollContainer): IElementFinder {
  return {
    async getCurrentGoodsItemsList() {
      return Result.succeed(renderVisibleItems(scroller) as never)
    },
    async getGoodsItemsScrollContainer() {
      return Result.succeed(scroller as never)
    },
    async getIdFromGoodsItem(item) {
      return Result.succeed((item as unknown as FakeGoodsItem).id)
    },
    async getTitleFromGoodsItem(item) {
      return Result.succeed((item as unknown as FakeGoodsItem).title)
    },
    async getPopUpButtonFromGoodsItem() {
      return Result.succeed({} as never)
    },
    async getCommentTextarea() {
      return Result.succeed({} as never)
    },
    async getClickableSubmitCommentButton() {
      return Result.succeed({} as never)
    },
    async getPinTopLabel() {
      return Result.succeed({} as never)
    },
  }
}

describe('getAllGoodsMetaFromScroller', () => {
  it('从当前停留在底部的虚拟列表重新扫到顶部并读取全部商品', async () => {
    const scroller = new FakeScrollContainer(41)
    scroller.scrollTo({ top: scroller.maxScrollTop })

    const result = await getAllGoodsMetaFromScroller({} as never, createElementFinder(scroller), 10)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) {
      throw result.error
    }

    expect(result.value).toHaveLength(41)
    expect(result.value.map(item => item.id)).toEqual(
      Array.from({ length: 41 }, (_, index) => index + 1),
    )
    expect(result.value[0]).toEqual({ id: 1, title: '商品 1' })
    expect(result.value[40]).toEqual({ id: 41, title: '商品 41' })
    expect(scroller.scrollTop).toBe(scroller.maxScrollTop)
  })
})

describe('comment', () => {
  it('uses a real button click and succeeds only after the input is cleared', async () => {
    const textarea = new FakeCommentTextarea()
    const button = new FakeCommentButton(() => {
      textarea.value = ''
    })
    const elementFinder = {
      ...createElementFinder(new FakeScrollContainer(0)),
      async getCommentTextarea() {
        return Result.succeed(textarea as never)
      },
      async getClickableSubmitCommentButton() {
        return Result.succeed(button as never)
      },
    }

    const result = await comment({} as never, elementFinder, '欢迎来到直播间')

    expect(Result.isSuccess(result)).toBe(true)
    expect(textarea.fill).toHaveBeenCalledWith('欢迎来到直播间', { timeout: 5000 })
    expect(button.click).toHaveBeenCalledWith({ timeout: 5000 })
    expect(button.dispatchEvent).not.toHaveBeenCalled()
  })

  it('fails when clicking send leaves the comment draft in the input', async () => {
    const textarea = new FakeCommentTextarea()
    const button = new FakeCommentButton()
    const elementFinder = {
      ...createElementFinder(new FakeScrollContainer(0)),
      async getCommentTextarea() {
        return Result.succeed(textarea as never)
      },
      async getClickableSubmitCommentButton() {
        return Result.succeed(button as never)
      },
    }

    const result = await comment({} as never, elementFinder, '这条没有发出去')

    expect(Result.isFailure(result)).toBe(true)
    expect(button.click).toHaveBeenCalledWith({ timeout: 5000 })
    if (Result.isFailure(result)) {
      expect(result.error.message).toContain('评论输入框未清空')
    }
  })
})
