import { describe, expect, it } from 'vitest'
import type { Message, ReplyPreview } from '@/hooks/autoReplyTypes'
import {
  buildAutoReplyKnowledgeBasis,
  buildAutoReplyWorkbenchConversation,
  buildAutoReplyWorkbenchTasks,
  buildScopedAutoReplyWorkbenchTasks,
  formatAutoReplyConversationTime,
  getAutoReplyDisplayName,
  getAutoReplyHistoryRuleCandidateState,
  getAutoReplyHistorySemanticGroupKey,
  getAutoReplyHistorySemanticKeywordAliases,
  getAutoReplyKeywordReplyMatchForMessage,
  getAutoReplyMessageDetail,
  getAutoReplyMessageDisplayName,
  getAutoReplyWorkbenchTaskState,
  getAutoReplyWorkbenchTaskStatus,
  isAutoReplyHistorySemanticConfiguredForMessage,
  isAutoReplyViewerComment,
  mergeAutoReplyKnowledgeRules,
} from '../autoReplyWorkbenchModel'

function createComment(
  overrides: Partial<Extract<Message, { msg_type: 'comment' }>> & {
    msg_id: string
    nick_name: string
    content: string
    time: string
  },
): Extract<Message, { msg_type: 'comment' }> {
  return {
    msg_type: 'comment',
    ...overrides,
  }
}

function createWechatComment(
  overrides: Partial<Extract<Message, { msg_type: 'wechat_channel_live_msg' }>> & {
    msg_id: string
    nick_name: string
    user_id: string
    content: string
    time: string
  },
): Extract<Message, { msg_type: 'wechat_channel_live_msg' }> {
  return {
    msg_type: 'wechat_channel_live_msg',
    ...overrides,
  }
}

function createReply(overrides: Partial<ReplyPreview> & Pick<ReplyPreview, 'commentId'>) {
  return {
    id: `${overrides.commentId}-reply`,
    commentId: overrides.commentId,
    replyFor: '符千千',
    replyContent: '默认回复',
    time: '10:00:10',
    isSent: true,
    source: 'ai',
    ...overrides,
  } satisfies ReplyPreview
}

describe('autoReplyWorkbenchModel', () => {
  it('formats AM/PM clock strings as 24-hour time', () => {
    expect(formatAutoReplyConversationTime('7:51:21 PM')).toBe('19:51:21')
    expect(formatAutoReplyConversationTime('12:03:04 AM')).toBe('00:03:04')
    expect(formatAutoReplyConversationTime('9:08')).toBe('09:08:00')
  })

  it('builds a same-viewer conversation and keeps unsent previews out of history', () => {
    const comments = [
      createComment({
        msg_id: 'c-3',
        nick_name: '路人',
        content: '多少钱',
        time: '10:00:20',
      }),
      createComment({
        msg_id: 'c-2',
        nick_name: '符千千',
        content: '是不是真的蜂蜜？',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '符千千',
        content: '主播在吗',
        time: '10:00:00',
      }),
    ]
    const replies = [
      createReply({
        id: 'r-2',
        commentId: 'c-2',
        replyContent: '还没发送的建议',
        time: '10:00:12',
        isSent: false,
        source: 'product-kb',
      }),
      createReply({
        id: 'r-1',
        commentId: 'c-1',
        replyContent: '在的，看上哪款了',
        time: '10:00:01',
        isSent: true,
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[1],
      comments,
      replies,
      operatorName: '主播号',
    })

    expect(conversation.map(item => item.content)).toEqual([
      '主播在吗',
      '在的，看上哪款了',
      '是不是真的蜂蜜？',
    ])
    expect(conversation.map(item => item.role)).toEqual(['viewer', 'operator', 'viewer'])
    expect(conversation[1]?.author).toBe('主播号')
    expect(conversation[1]?.sourceLabel).toBe('AI回复')
    expect(conversation[2]?.isCurrentComment).toBe(true)
  })

  it('labels sent manual replies as human replies in conversation history', () => {
    const comments = [
      createComment({
        msg_id: 'c-1',
        nick_name: '周姐',
        content: '效果有你说的好吗',
        time: '5:04:29 PM',
      }),
    ]
    const replies = [
      createReply({
        id: 'r-1',
        commentId: 'c-1',
        replyContent: '@周姐 好用',
        time: '5:04:51 PM',
        isSent: true,
        source: 'manual',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies,
      operatorName: '小羊好物',
    })

    expect(conversation[1]?.content).toBe('@周姐 好用')
    expect(conversation[1]?.sourceLabel).toBe('人工回复')
  })

  it('uses user id before nickname when grouping viewer thread', () => {
    const comments = [
      createWechatComment({
        msg_id: 'c-3',
        nick_name: '符千千',
        user_id: 'u-2',
        content: '同名但不是一个人',
        time: '10:00:05',
      }),
      createWechatComment({
        msg_id: 'c-2',
        nick_name: '符千千',
        user_id: 'u-1',
        content: '现在还能拍吗',
        time: '10:00:02',
      }),
      createWechatComment({
        msg_id: 'c-1',
        nick_name: '小符',
        user_id: 'u-1',
        content: '蜂蜜怎么吃',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[1],
      comments,
      replies: [],
    })

    expect(conversation.map(item => item.content)).toEqual(['蜂蜜怎么吃', '现在还能拍吗'])
  })

  it('uses cleaned platform nickname labels when grouping viewer thread', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '潜在新客无边无际',
        content: '主播什么时候发货？刚刚拍了一单',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '无边无际',
        content: '拍了一单',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(conversation.map(item => item.author)).toEqual(['无边无际', '无边无际'])
    expect(conversation.map(item => item.content)).toEqual([
      '拍了一单',
      '主播什么时候发货？刚刚拍了一单',
    ])
  })

  it('removes platform quality-user labels from viewer names', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '优质用户用户1850540652077',
        content: '哪里发货啊?',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '用户1850540652077',
        content: '拍了',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(getAutoReplyDisplayName(comments[0].nick_name)).toBe('用户1850540652077')
    expect(conversation.map(item => item.author)).toEqual([
      '用户1850540652077',
      '用户1850540652077',
    ])
  })

  it('removes platform purchased labels from viewer names', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '已购买好运连连',
        content: '发什么快递?',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '好运连连',
        content: '已拍',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(getAutoReplyDisplayName(comments[0].nick_name)).toBe('好运连连')
    expect(conversation.map(item => item.author)).toEqual(['好运连连', '好运连连'])
  })

  it('removes platform recent-purchase labels from viewer names', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '近期购买ZWP',
        content: '几天发货?',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: 'ZWP',
        content: '刚拍了一单',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(getAutoReplyDisplayName(comments[0].nick_name)).toBe('ZWP')
    expect(conversation.map(item => item.author)).toEqual(['ZWP', 'ZWP'])
  })

  it('removes platform pending-payment labels from viewer names', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '待支付用户5792235551782',
        content: '怎么付款?',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '用户5792235551782',
        content: '还在吗',
        time: '10:00:00',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(getAutoReplyDisplayName(comments[0].nick_name)).toBe('用户5792235551782')
    expect(conversation.map(item => item.author)).toEqual([
      '用户5792235551782',
      '用户5792235551782',
    ])
  })

  it('collapses duplicate context comments and keeps the selected state on the remaining row', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '有根',
        content: '跳蛋最多该产品有效果吗，，有效距离多少',
        time: '4:52:05 PM',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '有根',
        content: '跳蛋最多该产品有效果吗，，有效距离多少',
        time: '4:52:03 PM',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(conversation.map(item => item.commentId)).toEqual(['c-1'])
    expect(conversation.map(item => item.content)).toEqual([
      '跳蛋最多该产品有效果吗，，有效距离多少',
    ])
    expect(conversation[0]?.isCurrentComment).toBe(true)
  })

  it('collapses same-content context comments within a short platform resend window', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '谁懂我的心',
        content: '拍了，希望好用',
        time: '4:57:01 PM',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '谁懂我的心',
        content: '拍了，希望好用',
        time: '4:56:59 PM',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(conversation.map(item => item.commentId)).toEqual(['c-1'])
    expect(conversation.map(item => item.content)).toEqual(['拍了，希望好用'])
    expect(conversation[0]?.isCurrentComment).toBe(true)
  })

  it('keeps repeated same-content comments when they are outside the resend window', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '谁懂我的心',
        content: '拍了，希望好用',
        time: '4:57:10 PM',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '谁懂我的心',
        content: '拍了，希望好用',
        time: '4:56:59 PM',
      }),
    ]

    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(conversation.map(item => item.commentId)).toEqual(['c-1', 'c-2'])
  })

  it('formats order messages as readable conversation content', () => {
    const order = {
      msg_type: 'live_order',
      msg_id: 'order-1',
      nick_name: '用户A',
      order_status: '已付款',
      order_ts: 1,
      product_id: 'p-1',
      product_title: '蜂蜜礼盒',
      time: '10:00:00',
    } satisfies Extract<Message, { msg_type: 'live_order' }>

    expect(getAutoReplyMessageDetail(order)).toBe('蜂蜜礼盒')
  })

  it('keeps the workbench queue scoped to viewer text comments', () => {
    const viewerComment = createComment({
      msg_id: 'viewer-1',
      nick_name: '潜在新客小冉优选',
      content: '19块8还有吗',
      time: '10:00:00',
    })
    const hostComment = createComment({
      msg_id: 'host-1',
      nick_name: '主播我',
      content: '19块8，拍一斤送一斤',
      time: '10:00:01',
    })
    const likeMessage = {
      msg_type: 'room_like',
      msg_id: 'like-1',
      nick_name: '小冉优选',
      user_id: 'u-1',
      time: '10:00:02',
    } satisfies Extract<Message, { msg_type: 'room_like' }>

    expect(getAutoReplyDisplayName(viewerComment.nick_name)).toBe('小冉优选')
    expect(getAutoReplyDisplayName(hostComment.nick_name)).toBe('我')
    expect(isAutoReplyViewerComment(viewerComment, '我')).toBe(true)
    expect(isAutoReplyViewerComment(hostComment, '我')).toBe(false)
    expect(isAutoReplyViewerComment(likeMessage, '我')).toBe(false)
  })

  it('excludes the configured main account name from the viewer queue', () => {
    const comments = [
      createComment({
        msg_id: 'host-1',
        nick_name: '小冉优选',
        content: '19块8，拍一斤送一斤，到手整整两大斤',
        time: '10:00:02',
      }),
      createComment({
        msg_id: 'viewer-1',
        nick_name: '用户1850540652077',
        content: '哪里发货啊?',
        time: '10:00:01',
      }),
    ]

    const tasks = buildAutoReplyWorkbenchTasks({
      comments,
      replies: [],
      operatorName: ['我', '小冉优选'],
    })

    expect(isAutoReplyViewerComment(comments[0], ['我', '小冉优选'])).toBe(false)
    expect(tasks.map(task => task.comment.msg_id)).toEqual(['viewer-1'])
  })

  it('keeps only the latest queue item for each real viewer', () => {
    const comments = [
      createComment({
        msg_id: 'c-3',
        nick_name: '潜在新客无边无际',
        content: '已拍',
        time: '10:00:06',
      }),
      createComment({
        msg_id: 'c-2',
        nick_name: '无边无际',
        content: '主播什么时候发货？刚刚拍了一单',
        time: '10:00:05',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '主播我',
        content: '咱们是天然野生土蜂蜜中的，咱们百花蜜',
        time: '10:00:04',
      }),
    ]

    const tasks = buildAutoReplyWorkbenchTasks({
      comments,
      replies: [],
      operatorName: '我',
    })

    expect(tasks.map(task => task.comment.msg_id)).toEqual(['c-3'])
  })

  it('deduplicates platform messages when a time-like nickname suffix leaks into content', () => {
    const comments = [
      createComment({
        msg_id: 'c-2',
        nick_name: '雨中(王者创业21',
        content: '30): 杀蟑螂效果怎么样',
        time: '5:17:54 PM',
      }),
      createComment({
        msg_id: 'c-1',
        nick_name: '雨中(王者创业21:30)',
        content: '杀蟑螂效果怎么样',
        time: '5:17:53 PM',
      }),
    ]

    const tasks = buildAutoReplyWorkbenchTasks({
      comments,
      replies: [],
    })
    const conversation = buildAutoReplyWorkbenchConversation({
      selectedComment: comments[0],
      comments,
      replies: [],
    })

    expect(tasks.map(task => task.comment.msg_id)).toEqual(['c-2'])
    expect(getAutoReplyMessageDisplayName(comments[0])).toBe('雨中(王者创业21:30)')
    expect(getAutoReplyMessageDetail(comments[0])).toBe('杀蟑螂效果怎么样')
    expect(conversation.map(item => item.content)).toEqual(['杀蟑螂效果怎么样'])
  })

  it('keeps one latest queue item per viewer id when names collide', () => {
    const comments = [
      createWechatComment({
        msg_id: 'c-4',
        nick_name: '符千千',
        user_id: 'u-2',
        content: '二号还有吗',
        time: '10:00:06',
      }),
      createWechatComment({
        msg_id: 'c-3',
        nick_name: '小符',
        user_id: 'u-1',
        content: '现在还能拍吗',
        time: '10:00:05',
      }),
      createWechatComment({
        msg_id: 'c-2',
        nick_name: '符千千',
        user_id: 'u-1',
        content: '蜂蜜怎么吃',
        time: '10:00:02',
      }),
      createWechatComment({
        msg_id: 'c-1',
        nick_name: '符千千',
        user_id: 'u-2',
        content: '一号发什么快递',
        time: '10:00:00',
      }),
    ]

    const tasks = buildAutoReplyWorkbenchTasks({
      comments,
      replies: [],
    })

    expect(tasks.map(task => task.comment.msg_id)).toEqual(['c-4', 'c-3'])
  })

  it('keeps viewer dedupe scoped to each account in the unified queue', () => {
    const tasks = buildScopedAutoReplyWorkbenchTasks({
      sources: [
        {
          accountId: 'account-a',
          accountName: '一号直播间',
          platformLabel: '巨量百应',
          operatorName: '一号直播间',
          comments: [
            createComment({
              msg_id: 'a-new',
              nick_name: '小李',
              content: '一号还有吗',
              time: '10:00:04',
            }),
            createComment({
              msg_id: 'a-old',
              nick_name: '小李',
              content: '怎么拍',
              time: '10:00:01',
            }),
          ],
          replies: [],
        },
        {
          accountId: 'account-b',
          accountName: '二号直播间',
          platformLabel: '抖音',
          operatorName: '二号直播间',
          comments: [
            createComment({
              msg_id: 'b-new',
              nick_name: '小李',
              content: '二号多少钱',
              time: '10:00:05',
            }),
          ],
          replies: [],
        },
      ],
    })

    expect(tasks.map(task => task.taskKey)).toEqual(['account-b:b-new', 'account-a:a-new'])
    expect(tasks.map(task => task.accountName)).toEqual(['二号直播间', '一号直播间'])
  })

  it('splits viewer questions and recommends reusable keywords', () => {
    const basis = buildAutoReplyKnowledgeBasis('主播什么时候发货？刚刚拍了一单')

    expect(basis.questionSegments).toEqual(['什么时候发货', '刚刚拍了一单'])
    expect(basis.keywords).toEqual(['发货', '刚刚拍了一单'])
  })

  it('keeps recommended keywords scoped to the current question text', () => {
    const basis = buildAutoReplyKnowledgeBasis('拍了一单，辽宁几天到?')

    expect(basis.questionSegments).toEqual(['拍了一单', '辽宁几天到'])
    expect(basis.keywords).toEqual(['拍了一单', '辽宁几天到'])
  })

  it('preserves decimal prices and normalizes purchase spec questions as keywords', () => {
    const basis = buildAutoReplyKnowledgeBasis('我拍了19.8的几盒')

    expect(basis.questionSegments).toEqual(['我拍了19.8的几盒'])
    expect(basis.keywords).toEqual(['我拍了', '19.8是几盒'])
  })

  it('keeps platform emoji codes out of recommended keywords', () => {
    const basis = buildAutoReplyKnowledgeBasis('我买一二斤[赞][赞][赞][爱心][爱心][感谢]')

    expect(basis.keywords).toEqual(['我买一二斤'])
  })

  it('marks sent, ignored, configured, and unconfigured queue statuses', () => {
    const nowMs = new Date('2026-05-23T12:01:01.000Z').getTime()
    const freshComment = createComment({
      msg_id: 'fresh',
      nick_name: '何老大',
      content: '保质多久？',
      time: '2026-05-23T12:00:30.000Z',
    })
    const expiredComment = createComment({
      msg_id: 'expired',
      nick_name: '何老大',
      content: '多少钱？',
      time: '2026-05-23T12:00:00.000Z',
    })
    const config = {
      comment: {
        keywordReply: {
          enable: true,
          rules: [{ keywords: ['保质'], contents: ['保质期 18 个月'] }],
        },
      },
    }

    expect(
      getAutoReplyWorkbenchTaskStatus({
        task: { comment: freshComment, reply: createReply({ commentId: 'fresh', isSent: true }) },
        config,
        nowMs,
      }),
    ).toBe('sent')
    expect(
      getAutoReplyWorkbenchTaskStatus({ task: { comment: expiredComment }, config, nowMs }),
    ).toBe('ignored')
    expect(
      getAutoReplyWorkbenchTaskState({ task: { comment: expiredComment }, config, nowMs }),
    ).toMatchObject({
      status: 'ignored',
      isIgnored: true,
      isUnconfigured: true,
    })
    expect(
      getAutoReplyWorkbenchTaskStatus({ task: { comment: freshComment }, config, nowMs }),
    ).toBe('configured')
    expect(
      getAutoReplyWorkbenchTaskStatus({
        task: {
          comment: {
            ...freshComment,
            msg_id: 'unconfigured',
            content: '发什么快递？',
          },
        },
        config,
        nowMs,
      }),
    ).toBe('unconfigured')
  })

  it('returns the matched keyword reply content for configured comments', () => {
    const comment = createComment({
      msg_id: 'configured-content',
      nick_name: '杨大姐',
      content: '我拍了一单加急发货',
      time: '2026-05-23T12:00:30.000Z',
    })
    const config = {
      comment: {
        keywordReply: {
          enable: true,
          rules: [{ keywords: ['拍了一单'], contents: ['下午 5 点前会发出'] }],
        },
      },
    }

    expect(getAutoReplyKeywordReplyMatchForMessage(comment, config)).toMatchObject({
      keyword: '拍了一单',
      content: '下午 5 点前会发出',
    })
  })

  it('does not mark keyword-only rules as configured', () => {
    const comment = createComment({
      msg_id: 'keyword-only',
      nick_name: '杨大姐',
      content: '我拍了一单加急发货',
      time: '2026-05-23T12:00:30.000Z',
    })
    const config = {
      comment: {
        keywordReply: {
          enable: true,
          rules: [{ keywords: ['拍了一单'], contents: [] }],
        },
      },
    }

    expect(getAutoReplyKeywordReplyMatchForMessage(comment, config)).toBeNull()
    expect(
      getAutoReplyWorkbenchTaskStatus({
        task: { comment },
        config,
        nowMs: new Date('2026-05-23T12:00:31.000Z').getTime(),
      }),
    ).toBe('unconfigured')
  })

  it('does not recommend emoji-only platform codes as keywords', () => {
    const basis = buildAutoReplyKnowledgeBasis('[鼓掌][鼓掌][赞][赞][感谢][抱拳]')

    expect(basis.questionSegments).toEqual([])
    expect(basis.keywords).toEqual([])
  })

  it('merges saved knowledge into matching keyword rules', () => {
    const rules = mergeAutoReplyKnowledgeRules(
      [
        {
          keywords: ['发货'],
          contents: ['今天下午统一发'],
        },
      ],
      {
        keywords: ['发货', '下单'],
        contents: ['下午 5 点前的订单当天发出'],
      },
    )

    expect(rules).toEqual([
      {
        keywords: ['发货', '下单'],
        contents: ['今天下午统一发', '下午 5 点前的订单当天发出'],
      },
    ])
  })

  it('keeps larger AI keyword groups when saving history knowledge', () => {
    const keywords = [
      '那蚊子会死吗',
      '这个可以灭臭虫吗',
      '跳蚤可以吗',
      '可以灭臭虫吗',
      '那蚊子会死吗?',
      '这个可以灭臭虫吗?',
      '蟑螂可以吗',
      '蚂蚁能用吗',
    ]
    const rules = mergeAutoReplyKnowledgeRules([], {
      keywords,
      contents: ['可以按这个方向回复'],
    })

    expect(rules[0]?.keywords).toEqual(keywords)
  })

  it('recommends unconfigured history comments that are useful for keyword rules', () => {
    const comment = createComment({
      msg_id: 'history-1',
      nick_name: '何老大',
      content: '保质多久？',
      time: '10:00:00',
    })

    const candidate = getAutoReplyHistoryRuleCandidateState({
      comment,
      reply: createReply({
        commentId: 'history-1',
        replyContent: '保质期 18 个月',
      }),
      duplicateCount: 3,
      config: {
        comment: {
          keywordReply: {
            enable: true,
            rules: [],
          },
        },
      },
    })

    expect(candidate).toMatchObject({
      isCandidate: true,
      isConfigured: false,
      duplicateCount: 3,
      hasReply: true,
    })
    expect(candidate.keywords).toEqual(['保质'])
    expect(candidate.reasons).toEqual(['同类 3 条', '已回复可复用', '常见问法'])
  })

  it('does not recommend history comments that already match keyword rules', () => {
    const comment = createComment({
      msg_id: 'history-2',
      nick_name: '何老大',
      content: '保质多久？',
      time: '10:00:00',
    })

    const candidate = getAutoReplyHistoryRuleCandidateState({
      comment,
      duplicateCount: 2,
      config: {
        comment: {
          keywordReply: {
            enable: true,
            rules: [{ keywords: ['保质'], contents: ['保质期 18 个月'] }],
          },
        },
      },
    })

    expect(candidate.isConfigured).toBe(true)
    expect(candidate.isCandidate).toBe(false)
  })

  it('groups obvious order-confirmation variants as one history configuration intent', () => {
    const keys = ['下单了', '已下单', '拍了', '已拍'].map(getAutoReplyHistorySemanticGroupKey)

    expect(new Set(keys)).toEqual(new Set(['intent:order-confirmed']))
    expect(getAutoReplyHistorySemanticKeywordAliases('已拍')).toEqual([
      '下单了',
      '已下单',
      '拍了',
      '已拍',
    ])
  })

  it('treats configured order-confirmation aliases as covered history comments', () => {
    const comment = createComment({
      msg_id: 'history-3',
      nick_name: '何老大',
      content: '下单了',
      time: '10:00:00',
    })
    const config = {
      comment: {
        keywordReply: {
          enable: true,
          rules: [{ keywords: ['已拍'], contents: ['收到，给您尽快安排'] }],
        },
      },
    }

    expect(isAutoReplyHistorySemanticConfiguredForMessage(comment, config)).toBe(true)
    expect(
      getAutoReplyHistoryRuleCandidateState({
        comment,
        duplicateCount: 2,
        config,
      }).isCandidate,
    ).toBe(false)
  })

  it('keeps purchase spec questions out of the generic order-confirmation group', () => {
    expect(getAutoReplyHistorySemanticGroupKey('我拍了19.8的几盒')).toBe('intent:spec')
  })
})
