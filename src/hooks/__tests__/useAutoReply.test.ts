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

describe('useAutoReplyStore account hydration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.clear()

    const { LocalStorageAdapter, storageManager } = await import('@/utils/storage')
    storageManager.registerAdapter(new LocalStorageAdapter())
    storageManager.clear()
    storageManager.setCurrentUser(null)

    const { useAccounts } = await import('@/hooks/useAccounts')
    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')

    useAccounts.setState({
      accounts: [
        { id: 'acc-a', name: '账号A' },
        { id: 'acc-b', name: '账号B' },
      ],
      currentAccountId: 'acc-a',
      defaultAccountId: 'acc-a',
      currentUserId: 'user-1',
    })

    useAutoReplyStore.setState({
      contexts: {},
      currentUserId: null,
    })
  })

  it('ensureContextLoaded should not reset another active account', async () => {
    const { storageManager } = await import('@/utils/storage')
    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')

    storageManager.set(
      'auto-reply-history',
      {
        isRunning: false,
        isListening: 'stopped',
        comments: [],
        replies: [],
        currentSessionId: null,
        currentSessionStartedAt: null,
        currentSessionEndedAt: null,
        archivedSessionId: null,
        historySessions: [],
      },
      {
        level: 'account',
        userId: 'user-1',
        accountId: 'acc-b',
      },
    )

    useAutoReplyStore.setState({
      currentUserId: 'user-1',
      contexts: {
        'acc-a': {
          isRunning: true,
          isListening: 'listening',
          comments: [],
          replies: [],
          currentSessionId: 'session-a',
          currentSessionStartedAt: '2026-04-04T00:00:00.000Z',
          currentSessionEndedAt: null,
          archivedSessionId: null,
          historySessions: [],
          lastStopReason: undefined,
          lastStoppedAt: undefined,
          lastStopDetail: undefined,
        },
      },
    })

    useAutoReplyStore.getState().ensureContextLoaded('user-1', 'acc-b')

    const contexts = useAutoReplyStore.getState().contexts
    expect(contexts['acc-a']?.isRunning).toBe(true)
    expect(contexts['acc-a']?.isListening).toBe('listening')
    expect(contexts['acc-b']?.isListening).toBe('stopped')
  })

  it('addComments should keep newest comments first like repeated addComment calls', async () => {
    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')

    const createComment = (id: string): LiveMessage => ({
      msg_type: 'comment',
      msg_id: id,
      nick_name: `用户${id}`,
      content: `评论${id}`,
      time: '12:00:00',
    })

    useAutoReplyStore.getState().addComment('acc-a', createComment('old'))
    useAutoReplyStore
      .getState()
      .addComments('acc-a', [createComment('1'), createComment('2'), createComment('3')])

    expect(
      useAutoReplyStore.getState().contexts['acc-a']?.comments.map(item => item.msg_id),
    ).toEqual(['3', '2', '1', 'old'])
  })
})
