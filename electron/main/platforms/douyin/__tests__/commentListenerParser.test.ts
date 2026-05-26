import { describe, expect, it } from 'vitest'
import {
  extractCompassMessagesFromResponse,
  extractControlCommentsFromPayload,
  extractLiveOrderMessagesFromResponse,
  getControlCommentDedupeKey,
  parseControlDomCommentText,
} from '../commentListener'

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

  it('treats empty compass message groups as no comments', () => {
    expect(
      extractCompassMessagesFromResponse({
        data: { messages: null },
      } as never),
    ).toEqual([])

    expect(
      extractCompassMessagesFromResponse({
        data: { messages: { comment: null, room_like: [] } },
      } as never),
    ).toEqual([])
  })

  it('extracts compass comment-info fallback payloads', () => {
    const comments = extractCompassMessagesFromResponse({
      data: {
        messages: null,
        comment_infos: [
          {
            comment_id: 'fallback-1',
            nick_name: '小号用户',
            content: '222',
          },
        ],
      },
    } as never)

    expect(comments).toEqual([
      expect.objectContaining({
        msg_type: 'comment',
        msg_id: 'fallback-1',
        nick_name: '小号用户',
        content: '222',
      }),
    ])
  })

  it('treats empty live-order payloads as no order messages', () => {
    expect(
      extractLiveOrderMessagesFromResponse({
        data: null,
        msg: 'ok',
      } as never),
    ).toEqual([])
  })

  it('parses visible DOM comment text', () => {
    expect(parseControlDomCommentText('用户C\n回复\n什么时候发货')).toEqual(
      expect.objectContaining({
        nick_name: '用户C',
        content: '什么时候发货',
      }),
    )
  })

  it('dedupes API and DOM variants with control-panel user labels', () => {
    expect(
      getControlCommentDedupeKey({
        msg_id: 'api-comment-1',
        nick_name: '莉～',
        content: '什么颜色的',
      }),
    ).toBe(
      getControlCommentDedupeKey({
        nick_name: '潜在新客莉～',
        content: ' 什么颜色的 ',
      }),
    )
  })
})
