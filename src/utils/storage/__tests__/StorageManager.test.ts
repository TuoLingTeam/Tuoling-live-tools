import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageAdapter } from '../adapters/LocalStorageAdapter'
import { StorageManager } from '../StorageManager'
import type { StorageEntry } from '../types'

const storage = new Map<string, string>()

const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
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

function createManager(maxStorageSize: number) {
  const manager = new StorageManager({ maxStorageSize })
  manager.registerAdapter(new LocalStorageAdapter())
  return manager
}

function seedStorage(key: string, data: unknown) {
  const entry: StorageEntry<unknown> = {
    data,
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      size: JSON.stringify(data).length,
    },
  }

  storage.set(key, JSON.stringify(entry))
}

describe('StorageManager quota recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
  })

  it('allows a shrinking write when existing storage is already above quota', () => {
    const manager = createManager(80)
    seedStorage('xiuer-auto-message', { content: 'x'.repeat(200) })

    expect(() =>
      manager.set('auto-message', { content: 'short' }, { level: 'global' }),
    ).not.toThrow()

    const entry = JSON.parse(storage.get('xiuer-auto-message') ?? '') as StorageEntry<{
      content: string
    }>
    expect(entry.data.content).toBe('short')
  })

  it('compacts auto-reply history before blocking quota growth', () => {
    const manager = createManager(45_000)
    const historyKey = 'xiuer-auto-reply-history-user-1-account-1'
    const makeItems = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `item-${index}`,
        content: `message-${index}`,
      }))

    seedStorage(historyKey, {
      comments: makeItems(200),
      replies: makeItems(200),
      historySessions: Array.from({ length: 30 }, (_, index) => ({
        sessionId: `session-${index}`,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        comments: makeItems(80),
        replies: makeItems(80),
      })),
    })

    manager.set('auto-message', { messages: ['ok'] }, { level: 'global' })

    const entry = JSON.parse(storage.get(historyKey) ?? '') as StorageEntry<{
      comments: unknown[]
      replies: unknown[]
      historySessions: Array<{ comments: unknown[]; replies: unknown[] }>
    }>
    expect(entry.data.comments).toHaveLength(50)
    expect(entry.data.replies).toHaveLength(50)
    expect(entry.data.historySessions).toHaveLength(10)
    expect(entry.data.historySessions[0].comments).toHaveLength(50)
    expect(entry.data.historySessions[0].replies).toHaveLength(50)
  })
})
