import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_REPLY_HISTORY_RETENTION_DAYS,
  type AutoReplyContext,
  restoreAutoReplyContext,
  serializeAutoReplyContext,
} from '../autoReplyStoreHelpers'

function createComment(id: string, time: string): LiveMessage {
  return {
    msg_type: 'comment',
    msg_id: id,
    nick_name: `用户${id}`,
    content: `评论${id}`,
    time,
  }
}

function createContext(): AutoReplyContext {
  return {
    isRunning: true,
    isListening: 'listening',
    comments: [
      createComment('recent-current', '2026-05-22T12:00:00.000Z'),
      createComment('old-current', '2026-05-10T12:00:00.000Z'),
    ],
    replies: [],
    currentSessionId: 'current',
    currentSessionStartedAt: '2026-05-22T12:00:00.000Z',
    currentSessionEndedAt: null,
    archivedSessionId: null,
    historySessions: [
      {
        sessionId: 'recent-session',
        startedAt: '2026-05-20T12:00:00.000Z',
        endedAt: '2026-05-20T13:00:00.000Z',
        comments: [createComment('recent-history', '2026-05-20T12:10:00.000Z')],
        replies: [],
      },
      {
        sessionId: 'old-session',
        startedAt: '2026-05-01T12:00:00.000Z',
        endedAt: '2026-05-01T13:00:00.000Z',
        comments: [createComment('old-history', '2026-05-01T12:10:00.000Z')],
        replies: [],
      },
    ],
  }
}

describe('autoReplyStoreHelpers history retention', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`keeps only the latest ${AUTO_REPLY_HISTORY_RETENTION_DAYS} days in local history`, () => {
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'))

    const serialized = serializeAutoReplyContext(createContext())
    const restored = restoreAutoReplyContext(createContext())

    expect(serialized.comments.map(comment => comment.msg_id)).toEqual(['recent-current'])
    expect(serialized.historySessions.map(session => session.sessionId)).toEqual(['recent-session'])
    expect(restored.comments.map(comment => comment.msg_id)).toEqual(['recent-current'])
    expect(restored.historySessions.map(session => session.sessionId)).toEqual(['recent-session'])
  })
})
