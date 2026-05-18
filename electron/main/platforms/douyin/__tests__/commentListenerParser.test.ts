import { describe, expect, it } from 'vitest'
import { extractControlCommentsFromPayload, parseControlDomCommentText } from '../commentListener'

describe('douyin control comment parsing', () => {
  it('extracts the current control comment/info payload shape', () => {
    const comments = extractControlCommentsFromPayload({
      data: {
        comment_infos: [
          {
            comment_id: 'c-1',
            nick_name: '用户A',
            content: '这个多少钱',
          },
        ],
      },
    })

    expect(comments).toEqual([
      expect.objectContaining({
        msg_id: 'c-1',
        nick_name: '用户A',
        content: '这个多少钱',
      }),
    ])
  })

  it('extracts nested text comment payloads when endpoint names change', () => {
    const comments = extractControlCommentsFromPayload({
      data: {
        messages: {
          comment: [
            {
              msgId: 'm-1',
              nickname: '用户B',
              text: '发什么快递',
              msgType: 'comment',
            },
          ],
        },
      },
    })

    expect(comments).toEqual([
      expect.objectContaining({
        msg_id: 'm-1',
        nick_name: '用户B',
        content: '发什么快递',
      }),
    ])
  })

  it('parses visible DOM comment text', () => {
    expect(parseControlDomCommentText('用户C\n回复\n什么时候发货')).toEqual(
      expect.objectContaining({
        nick_name: '用户C',
        content: '什么时候发货',
      }),
    )
  })
})
