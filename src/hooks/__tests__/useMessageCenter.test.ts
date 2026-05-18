import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageListResponse } from '@/services/apiClient'

const getMessagesMock = vi.fn()
const markMessageReadMock = vi.fn()
const markAllMessagesReadMock = vi.fn()
const connectMessageStreamMock = vi.fn()

vi.mock('@/services/apiClient', () => ({
  getMessages: (...args: unknown[]) => getMessagesMock(...args),
  markMessageRead: (...args: unknown[]) => markMessageReadMock(...args),
  markAllMessagesRead: (...args: unknown[]) => markAllMessagesReadMock(...args),
  connectMessageStream: (...args: unknown[]) => connectMessageStreamMock(...args),
}))

describe('useMessageCenterStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useMessageCenterStore } = await import('@/hooks/useMessageCenter')
    useMessageCenterStore.getState().reset()
  })

  it('refresh applies snapshots and reports newly unread messages for automatic reminders', async () => {
    const initialSnapshot: MessageListResponse = {
      success: true,
      items: [],
      unread_count: 0,
      fetched_at: '2026-05-17T00:00:00.000Z',
    }
    const nextSnapshot: MessageListResponse = {
      success: true,
      items: [
        {
          id: 'message-1',
          title: '系统维护通知',
          content: '今晚会有一次短暂维护。',
          type: 'notice',
          is_pinned: false,
          is_read: false,
          created_at: '2026-05-17T00:00:00.000Z',
          published_at: '2026-05-17T00:00:00.000Z',
          expires_at: null,
        },
      ],
      unread_count: 1,
      fetched_at: '2026-05-17T00:00:30.000Z',
    }

    getMessagesMock
      .mockResolvedValueOnce({ ok: true, data: initialSnapshot })
      .mockResolvedValueOnce({ ok: true, data: nextSnapshot })

    const { useMessageCenterStore } = await import('@/hooks/useMessageCenter')

    await expect(useMessageCenterStore.getState().refresh()).resolves.toMatchObject({
      success: true,
      increased: 0,
    })

    await expect(useMessageCenterStore.getState().refresh()).resolves.toMatchObject({
      success: true,
      increased: 1,
      latestTitle: '系统维护通知',
    })

    expect(useMessageCenterStore.getState()).toMatchObject({
      unreadCount: 1,
      initialized: true,
      fetchedAt: '2026-05-17T00:00:30.000Z',
    })
  })

  it('keeps the message center backstop interval short enough to replace manual refresh', async () => {
    const { MESSAGE_CENTER_BACKSTOP_POLL_MS } = await import('@/hooks/useMessageCenter')

    expect(MESSAGE_CENTER_BACKSTOP_POLL_MS).toBeGreaterThan(0)
    expect(MESSAGE_CENTER_BACKSTOP_POLL_MS).toBeLessThanOrEqual(30_000)
  })
})
