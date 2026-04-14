import { describe, expect, it } from 'vitest'
import {
  buildAutoReplyAnomalyInsights,
  buildAutoReplyKnowledgeLoopInsights,
} from '@/lib/autoReplyInsights'

describe('buildAutoReplyAnomalyInsights', () => {
  it('aggregates anomaly stats and samples', () => {
    const result = buildAutoReplyAnomalyInsights(
      [
        {
          msg_id: 'c-1',
          nick_name: '秀儿',
          content: '今天主推什么',
        },
        {
          msg_id: 'c-2',
          nick_name: '秀儿',
          content: '三号链接多少钱',
        },
      ],
      [
        {
          commentId: 'c-1',
          replyContent: '今天有几款在上架，您想先看哪号我给您介绍',
          replyIntent: 'product-list',
          factStatus: 'missing',
          guardrailAction: 'rewrite',
          guardrailReason: 'safe-fallback',
          knowledgeMissReason: 'no-items',
        },
        {
          commentId: 'c-2',
          replyContent: '3号链接现在99元',
          replyIntent: 'single-product',
          factStatus: 'grounded',
          guardrailAction: 'pass',
          autoSendBlockedReason: 'after-sales',
        },
      ],
    )

    expect(result.anomalyCount).toBe(1)
    expect(result.rewrittenCount).toBe(1)
    expect(result.missingFactCount).toBe(1)
    expect(result.knowledgeFallbackCount).toBe(1)
    expect(result.autoSendBlockedCount).toBe(1)
    expect(result.topGuardrailReasons[0]).toEqual(['safe-fallback', 1])
    expect(result.topKnowledgeMissReasons[0]).toEqual(['no-items', 1])
    expect(result.topAutoSendBlockedReasons[0]).toEqual(['after-sales', 1])
    expect(result.anomalySamples[0]?.commentContent).toBe('今天主推什么')
    expect(result.suggestions[0]?.title).toBe('先建立商品知识卡')
  })

  it('builds knowledge-loop stats from sample decisions', () => {
    const result = buildAutoReplyKnowledgeLoopInsights({
      comments: [
        { msg_id: 'c-1', nick_name: '秀儿', content: '三号链接适合谁' },
        { msg_id: 'c-2', nick_name: '秀儿', content: '三号链接怎么用' },
        { msg_id: 'c-3', nick_name: '秀儿', content: '五号链接多少钱' },
      ],
      replies: [
        {
          commentId: 'c-1',
          replyContent: '3号更适合干皮和混干皮',
          matchedSlotIndex: 3,
          time: '2026-04-13T12:00:00.000Z',
        },
        {
          commentId: 'c-2',
          replyContent: '洁面后直接涂就可以了',
          matchedSlotIndex: 3,
          time: '2026-04-13T12:05:00.000Z',
        },
        {
          commentId: 'c-3',
          replyContent: '5号现在79元',
          matchedSlotIndex: 5,
          time: '2026-04-13T12:10:00.000Z',
        },
      ],
      decisions: {
        '3:c-1': { status: 'adopted', decidedAt: '2026-04-13T12:02:00.000Z' },
        '5:c-3': { status: 'dismissed', decidedAt: '2026-04-13T12:12:00.000Z' },
      },
    })

    expect(result.totalSamples).toBe(3)
    expect(result.pendingCount).toBe(1)
    expect(result.adoptedCount).toBe(1)
    expect(result.dismissedCount).toBe(1)
    expect(result.stabilizedGoodsCount).toBe(0)
    expect(result.topPendingGoods[0]).toEqual([3, 1])
    expect(result.recentHandledSamples[0]?.key).toBe('5:c-3')
    expect(result.topPostAdoptionPendingGoods[0]).toEqual([3, 1])
  })
})
