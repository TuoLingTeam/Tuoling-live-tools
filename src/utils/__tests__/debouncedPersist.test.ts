import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushAllPersists, flushPersist, schedulePersist } from '../debouncedPersist'

describe('debouncedPersist', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
      writable: true,
    })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    flushAllPersists()
    vi.useRealTimers()
    consoleErrorSpy.mockRestore()
  })

  it('logs scheduled persist errors instead of throwing from the timer', () => {
    const error = new Error('storage quota exceeded')

    schedulePersist(
      'quota:user-1:account-1',
      () => {
        throw error
      },
      10,
    )

    expect(() => vi.advanceTimersByTime(10)).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Persist] Failed to run task for quota:user-1:account-1:',
      error,
    )
  })

  it('logs flushed persist errors instead of throwing to callers', () => {
    const error = new Error('flush failed')

    schedulePersist('flush:user-1:account-1', () => {
      throw error
    })

    expect(() => flushPersist('flush:user-1:account-1')).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Persist] Failed to run task for flush:user-1:account-1:',
      error,
    )
  })
})
