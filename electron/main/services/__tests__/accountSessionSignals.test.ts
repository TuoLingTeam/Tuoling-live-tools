import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/windowManager', () => ({
  default: {
    send: vi.fn(),
  },
}))

import { bindAccountSessionBrowserEvents } from '../accountSessionSignals'

class FakeEmitter {
  private listeners = new Map<string, Array<(...args: any[]) => void>>()

  on(event: string, callback: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(callback)
    this.listeners.set(event, listeners)
  }

  emit(event: string, ...args: any[]) {
    for (const callback of this.listeners.get(event) ?? []) {
      callback(...args)
    }
  }
}

describe('bindAccountSessionBrowserEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('treats manual page close as browser_closed and ignores the following browser disconnect', () => {
    const page = new FakeEmitter()
    const browser = new FakeEmitter()
    const onPageClosed = vi.fn()

    bindAccountSessionBrowserEvents({
      browserSession: { page, browser } as any,
      accountId: 'acc-1',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      isDisconnecting: () => false,
      isDisconnected: () => false,
      isAuthExpired: () => false,
      onPageClosed,
    })

    page.emit('close')
    browser.emit('disconnected')
    vi.advanceTimersByTime(200)

    expect(onPageClosed).toHaveBeenCalledTimes(1)
    expect(onPageClosed).toHaveBeenCalledWith('browser_closed')
  })

  it('treats a standalone browser disconnect as page_crash after the grace window', () => {
    const page = new FakeEmitter()
    const browser = new FakeEmitter()
    const onPageClosed = vi.fn()

    bindAccountSessionBrowserEvents({
      browserSession: { page, browser } as any,
      accountId: 'acc-1',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      isDisconnecting: () => false,
      isDisconnected: () => false,
      isAuthExpired: () => false,
      onPageClosed,
    })

    browser.emit('disconnected')
    vi.advanceTimersByTime(149)
    expect(onPageClosed).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onPageClosed).toHaveBeenCalledTimes(1)
    expect(onPageClosed).toHaveBeenCalledWith('page_crash')
  })
})
