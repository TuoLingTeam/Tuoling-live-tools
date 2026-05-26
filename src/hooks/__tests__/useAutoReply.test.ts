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
    const { useAutoReplyConfigStore } = await import('@/hooks/useAutoReplyConfig')

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
    useAutoReplyConfigStore.setState({
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

  it('addComments should keep only real viewer comments when operator names are provided', async () => {
    const { useAutoReplyStore } = await import('@/hooks/useAutoReply')

    const createComment = (id: string, nickName: string): LiveMessage => ({
      msg_type: 'comment',
      msg_id: id,
      nick_name: nickName,
      content: `评论${id}`,
      time: '12:00:00',
    })
    const likeMessage = {
      msg_type: 'room_like',
      msg_id: 'like-1',
      nick_name: '真实用户',
      time: '12:00:01',
    } satisfies LiveMessage

    useAutoReplyStore
      .getState()
      .addComments(
        'acc-a',
        [
          createComment('host-name', '小冉优选'),
          createComment('host-label', '主播小冉优选'),
          createComment('viewer', '真实用户'),
          likeMessage,
        ],
        ['小冉优选'],
      )

    expect(
      useAutoReplyStore.getState().contexts['acc-a']?.comments.map(item => item.msg_id),
    ).toEqual(['viewer'])
  })

  it('should resolve processing config from the incoming comment account', async () => {
    const { getAutoReplyProcessingConfigForAccount } = await import('@/hooks/useAutoReply')
    const { createDefaultConfig, useAutoReplyConfigStore } = await import(
      '@/hooks/useAutoReplyConfig'
    )

    useAutoReplyConfigStore.setState({
      currentUserId: 'user-1',
      contexts: {
        'acc-a': {
          config: {
            ...createDefaultConfig(),
            comment: {
              ...createDefaultConfig().comment,
              keywordReply: {
                enable: true,
                rules: [{ keywords: ['账号A关键词'], contents: ['账号A回复'] }],
              },
            },
          },
        },
        'acc-b': {
          config: {
            ...createDefaultConfig(),
            comment: {
              ...createDefaultConfig().comment,
              keywordReply: {
                enable: true,
                rules: [{ keywords: ['账号B关键词'], contents: ['账号B回复'] }],
              },
            },
          },
        },
      },
    })

    expect(
      getAutoReplyProcessingConfigForAccount('acc-b').comment.keywordReply.rules[0]?.keywords,
    ).toEqual(['账号B关键词'])
  })
})
