import { describe, expect, it } from 'vitest'
import {
  isBrowserClosedReason,
  LIVE_CONTROL_DISCONNECT_REASONS,
  normalizeLiveControlDisconnectReason,
} from '../liveControlDisconnect'

describe('liveControlDisconnect helpers', () => {
  it('recognizes browser closed reasons from canonical and legacy messages', () => {
    expect(isBrowserClosedReason(LIVE_CONTROL_DISCONNECT_REASONS.browserClosed)).toBe(true)
    expect(isBrowserClosedReason('browser has been closed')).toBe(true)
    expect(isBrowserClosedReason('Target page, context or browser has been closed')).toBe(true)
  })

  it('normalizes legacy browser closed messages to the canonical reason', () => {
    expect(normalizeLiveControlDisconnectReason('browser has been closed')).toBe(
      LIVE_CONTROL_DISCONNECT_REASONS.browserClosed,
    )
    expect(
      normalizeLiveControlDisconnectReason('Target page, context or browser has been closed'),
    ).toBe(LIVE_CONTROL_DISCONNECT_REASONS.browserClosed)
  })

  it('leaves unrelated reasons unchanged', () => {
    expect(normalizeLiveControlDisconnectReason('auth_expired')).toBe('auth_expired')
  })
})
