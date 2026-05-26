import { describe, expect, it, vi } from 'vitest'
import {
  buildMentionedReplyContent,
  prependUsernameMention,
  sendConfiguredReply,
  stripMentionedReplyContent,
} from '@/hooks/autoReplyRuntime'
import { createDefaultConfig } from '@/hooks/useAutoReplyConfig'
import {
  buildAutoReplyConversation,
  buildAutoReplySystemPrompt,
  enforceAutoReplyLength,
  getAutoReplyAutoSendBlockedReason,
  sanitizeAutoReplyResponse,
  shouldAutoSendAutoReply,
  shouldSkipDuplicateReply,
} from '@/lib/autoReply'

describe('autoReply helpers', () => {
  it('adds strict output rules to the system prompt', () => {
    const prompt = buildAutoReplySystemPrompt('语气更活泼一点', '你是一个 helpful assistant')

    expect(prompt).toContain('你只需要输出最终要发送给观众的一句话回复')
    expect(prompt).toContain('不要输出 JSON')
    expect(prompt).toContain('每次只回复一句')
    expect(prompt).toContain('如果系统没有提供真实商品事实')
    expect(prompt).toContain('用户补充要求：\n语气更活泼一点')
    expect(prompt).toContain('你是一个 helpful assistant')
  })

  it('treats the legacy default prompt as empty user supplement', () => {
    const prompt = buildAutoReplySystemPrompt(
      '你是一个直播间的助手，负责回复观众的评论。请用简短友好的语气回复，不要超过50个字。',
    )

    expect(prompt).not.toContain('用户补充要求')
    expect(prompt).toContain('你是直播间口播助手')
  })

  it('removes echoed comment JSON and keeps the final natural-language reply', () => {
    const response =
      '{"nickname":"秀儿","content":"主播晚上好"} {"nickname":"秀儿","content":"主播真漂亮"} 晚上好秀儿！谢谢夸奖，三号链接马上展示！'

    expect(sanitizeAutoReplyResponse(response)).toBe('晚上好秀儿！谢谢夸奖，三号链接马上展示！')
  })

  it('unwraps common output labels', () => {
    expect(sanitizeAutoReplyResponse('建议回复：晚上好秀儿，链接马上展示！')).toBe(
      '晚上好秀儿，链接马上展示！',
    )
  })

  it('can prepend @username for ai replies', () => {
    expect(prependUsernameMention('3号是椰子水，29.9元', '秀儿', false)).toBe(
      '@秀儿 3号是椰子水，29.9元',
    )
    expect(prependUsernameMention('3号是椰子水，29.9元', '秀儿', true)).toBe(
      '@秀*** 3号是椰子水，29.9元',
    )
    expect(prependUsernameMention('秀儿，3号是椰子水', '秀儿', false)).toBe('@秀儿 3号是椰子水')
  })

  it('builds and strips viewer mentions with cleaned platform labels', () => {
    expect(buildMentionedReplyContent('已经拍了就等发货哈', '潜在新客无边无际', false)).toBe(
      '@无边无际 已经拍了就等发货哈',
    )
    expect(
      stripMentionedReplyContent('@无边无际 已经拍了就等发货哈', '潜在新客无边无际', false),
    ).toBe('已经拍了就等发货哈')
    expect(buildMentionedReplyContent('今天给你发出', '近期购买ZWP', false)).toBe(
      '@ZWP 今天给你发出',
    )
  })

  it('ignores message types that do not have event reply config', () => {
    const sendReply = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'autoReplyAPI', {
      value: { sendReply },
      configurable: true,
    })

    expect(() =>
      sendConfiguredReply(
        'acc-a',
        createDefaultConfig(),
        {
          msg_type: 'xiaohongshu_comment',
          msg_id: 'c-1',
          nick_name: '观众A',
          content: '你好',
          time: '12:00:00',
        },
        vi.fn(),
      ),
    ).not.toThrow()
    expect(sendReply).not.toHaveBeenCalled()
  })

  it('rejects pure JSON echo responses', () => {
    const response =
      '{"nickname":"秀儿","content":"主播好漂亮"} {"nickname":"秀儿","content":"看看三号链接"}'

    expect(sanitizeAutoReplyResponse(response)).toBeNull()
  })

  it('truncates overlong replies to the platform send limit', () => {
    const reply =
      '3号链接是豪园OVITEN 100%椰子水饮料清爽解腻电解质245ml*10袋运动补水，主打100%椰子水、清爽解腻、含电解质，现在¥29.90'

    const trimmed = enforceAutoReplyLength(reply)

    expect(trimmed.length).toBe(50)
    expect(reply.startsWith(trimmed)).toBe(true)
    expect(trimmed).toBe(
      '3号链接是豪园OVITEN 100%椰子水饮料清爽解腻电解质245ml*10袋运动补水，主打100%',
    )
  })

  it('builds context from the latest sent turn plus the current comment', () => {
    const messages = buildAutoReplyConversation(
      {
        msg_id: 'c-2',
        nick_name: '秀儿',
        content: '介绍下三号链接',
        time: '2026-03-31T21:00:00.000Z',
      },
      [
        {
          msg_id: 'c-1',
          nick_name: '秀儿',
          content: '主播今天好漂亮',
          time: '2026-03-31T20:59:00.000Z',
        },
        {
          msg_id: 'c-2',
          nick_name: '秀儿',
          content: '介绍下三号链接',
          time: '2026-03-31T21:00:00.000Z',
        },
      ],
      [
        {
          commentId: 'c-1',
          replyFor: '秀儿',
          replyContent: '谢谢夸奖呀',
          time: '2026-03-31T20:59:10.000Z',
          isSent: true,
        },
      ],
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: '{"nickname":"秀儿","content":"主播今天好漂亮"}',
      },
      {
        role: 'assistant',
        content: '谢谢夸奖呀',
      },
      {
        role: 'user',
        content: '{"nickname":"秀儿","content":"介绍下三号链接"}',
      },
    ])
  })

  it('ignores unsent preview replies when building context', () => {
    const messages = buildAutoReplyConversation(
      {
        msg_id: 'c-2',
        nick_name: '秀儿',
        content: '主播你在干嘛',
        time: '2026-03-31T21:00:00.000Z',
      },
      [
        {
          msg_id: 'c-1',
          nick_name: '秀儿',
          content: '我好喜欢主播啊',
          time: '2026-03-31T20:59:00.000Z',
        },
        {
          msg_id: 'c-2',
          nick_name: '秀儿',
          content: '主播你在干嘛',
          time: '2026-03-31T21:00:00.000Z',
        },
      ],
      [
        {
          commentId: 'c-1',
          replyFor: '秀儿',
          replyContent: '主播在的，今天想了解什么产品呢？',
          time: '2026-03-31T20:59:10.000Z',
          isSent: false,
        },
      ],
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: '{"nickname":"秀儿","content":"主播你在干嘛"}',
      },
    ])
  })

  it('can isolate the current comment from previous turns', () => {
    const messages = buildAutoReplyConversation(
      {
        msg_id: 'c-2',
        nick_name: '秀儿',
        content: '今天都有什么产品',
        time: '2026-03-31T21:00:00.000Z',
      },
      [
        {
          msg_id: 'c-1',
          nick_name: '秀儿',
          content: '介绍下三号链接',
          time: '2026-03-31T20:59:00.000Z',
        },
        {
          msg_id: 'c-2',
          nick_name: '秀儿',
          content: '今天都有什么产品',
          time: '2026-03-31T21:00:00.000Z',
        },
      ],
      [
        {
          commentId: 'c-1',
          replyFor: '秀儿',
          replyContent: '3号链接是修护面霜',
          time: '2026-03-31T20:59:10.000Z',
          isSent: true,
        },
      ],
      {
        mode: 'current-only',
      },
    )

    expect(messages).toEqual([
      {
        role: 'user',
        content: '{"nickname":"秀儿","content":"今天都有什么产品"}',
      },
    ])
  })

  it('skips duplicate replies within cooldown window', () => {
    expect(
      shouldSkipDuplicateReply({
        replyContent: '现在99元，点链接看详情哦！',
        lastReplyContent: '现在99元，点链接看详情哦',
        lastReplyAt: Date.now() - 10_000,
      }),
    ).toBe(true)
  })

  it('defaults auto send to safe-only mode for AI replies', () => {
    expect(
      shouldAutoSendAutoReply({
        autoSend: true,
        mode: 'ai',
      }),
    ).toBe(false)

    expect(
      shouldAutoSendAutoReply({
        autoSend: true,
        mode: 'product-kb',
      }),
    ).toBe(true)

    expect(
      shouldAutoSendAutoReply({
        autoSend: true,
        mode: 'safe-fallback',
      }),
    ).toBe(true)
  })

  it('can explicitly allow all reply modes to auto send', () => {
    expect(
      shouldAutoSendAutoReply({
        autoSend: true,
        mode: 'ai',
        scope: 'all',
      }),
    ).toBe(true)
  })

  it('blocks high-risk comments from auto send even when auto send is enabled', () => {
    expect(
      getAutoReplyAutoSendBlockedReason({
        commentContent: '这个能加微信私聊吗',
        replyContent: '可以看看详情页哦',
      }),
    ).toBe('private-contact')

    expect(
      getAutoReplyAutoSendBlockedReason({
        commentContent: '我要退款，质量有问题',
        replyContent: '这边先帮你看看',
      }),
    ).toBe('after-sales')
  })

  it('blocks risky reply content from auto send', () => {
    expect(
      getAutoReplyAutoSendBlockedReason({
        commentContent: '这个效果怎么样',
        replyContent: '这个绝对好用，保证能瘦',
      }),
    ).toBe('reply-compliance')
  })
})
