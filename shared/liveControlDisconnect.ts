export const LIVE_CONTROL_DISCONNECT_REASONS = {
  browserClosed: 'browser_closed',
  authExpired: 'auth_expired',
  pageCrash: 'page_crash',
  userDisconnect: 'user_disconnect',
} as const

const BROWSER_CLOSED_REASON_PATTERNS = [
  LIVE_CONTROL_DISCONNECT_REASONS.browserClosed,
  'browser has been closed',
  'Browser has been closed',
  'Target page, context or browser has been closed',
  'page has been closed',
  'context has been closed',
] as const

export function isBrowserClosedReason(reason?: string | null): boolean {
  if (!reason) {
    return false
  }

  return BROWSER_CLOSED_REASON_PATTERNS.some(pattern => reason.includes(pattern))
}

export function normalizeLiveControlDisconnectReason(reason?: string | null): string | undefined {
  if (!reason) {
    return undefined
  }

  if (isBrowserClosedReason(reason)) {
    return LIVE_CONTROL_DISCONNECT_REASONS.browserClosed
  }

  return reason
}
