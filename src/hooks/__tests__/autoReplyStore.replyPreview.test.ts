import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => (storage.has(key) ? storage.get(key)! : null)),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    storage.delete(key)
  }),
  clear: vi.fn(() => {
    storage.clear()
  }),
  key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
  get length() {
    return storage.size
  },
}

Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  configurable: true,
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
})

describe('useAutoReplyStore reply preview retention', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.clear()

    const { LocalStorageAdapter, storageManager } = await import('@/utils/storage')
    storageManager.registerAdapter(new LocalStorageAdapter())
    storageManager.clear()
    storageManager.setCurrentUser(null)

    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')
    useAutoReplyStore.setState({
      contexts: {},
      currentUserId: 'user-1',
    })
  })

  it('keeps earlier unsent previews for the same nickname when a new comment gets a reply', async () => {
    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')

    useAutoReplyStore
      .getState()
      .addReply(
        'acc-1',
        'comment-1',
        '秀儿',
        '这个发货问题需要人工确认一下哦',
        { source: 'ai', autoSendBlockedReason: 'after-sales' },
        false,
      )

    useAutoReplyStore
      .getState()
      .addReply(
        'acc-1',
        'comment-2',
        '秀儿',
        '3号链接是椰子水，29.9元',
        { source: 'product-kb' },
        false,
      )

    const replies = useAutoReplyStore.getState().contexts['acc-1']?.replies ?? []

    expect(replies).toHaveLength(2)
    expect(replies.map(reply => reply.commentId)).toEqual(['comment-2', 'comment-1'])
    expect(replies[1]?.autoSendBlockedReason).toBe('after-sales')
  })
})
