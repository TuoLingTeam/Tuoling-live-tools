import { describe, expect, it } from 'vitest'
import { isPersistableAutoReplyViewerComment } from '../autoReplyCommentShared'
import type { Message } from '../autoReplyTypes'

function createComment(overrides: Partial<Extract<Message, { msg_type: 'comment' }>>) {
  return {
    msg_type: 'comment',
    msg_id: 'comment-1',
    nick_name: '真实用户',
    content: '怎么买',
    time: '10:00:00',
    ...overrides,
  } satisfies Extract<Message, { msg_type: 'comment' }>
}

describe('autoReplyCommentShared', () => {
  it('keeps only real viewer comments for auto-reply history', () => {
    const likeMessage = {
      msg_type: 'room_like',
      msg_id: 'like-1',
      nick_name: '真实用户',
      time: '10:00:01',
    } satisfies Extract<Message, { msg_type: 'room_like' }>

    expect(isPersistableAutoReplyViewerComment(createComment({}), ['小冉优选'])).toBe(true)
    expect(
      isPersistableAutoReplyViewerComment(
        createComment({ msg_id: 'host-name', nick_name: '小冉优选' }),
        ['小冉优选'],
      ),
    ).toBe(false)
    expect(
      isPersistableAutoReplyViewerComment(
        createComment({ msg_id: 'host-label', nick_name: '主播小冉优选' }),
        ['小冉优选'],
      ),
    ).toBe(false)
    expect(isPersistableAutoReplyViewerComment(likeMessage, ['小冉优选'])).toBe(false)
  })
})
