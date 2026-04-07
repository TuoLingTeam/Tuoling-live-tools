import type { ReconnectReason } from '#/services/ReconnectManager'

export function isBenignCloseError(error: unknown): boolean {
  if (!error) {
    return false
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)

  return (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Browser has been closed') ||
    message.includes('browser has been closed') ||
    message.includes('page has been closed') ||
    message.includes('context has been closed')
  )
}

export function detectCloseReason(source: 'page' | 'browser'): ReconnectReason {
  if (source === 'page') {
    return 'browser_closed'
  }

  if (source === 'browser') {
    return 'browser_closed'
  }

  return 'page_crash'
}
