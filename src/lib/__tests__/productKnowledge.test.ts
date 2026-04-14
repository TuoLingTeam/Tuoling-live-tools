import { describe, expect, it } from 'vitest'
import {
  buildFallbackFaqFromKnowledgeDraft,
  buildProductKnowledgePolishPrompt,
  buildProductListReply,
  buildSafeProductFallbackReply,
  tryProductKnowledgeReply,
  validateGroundedProductReply,
} from '@/lib/productKnowledge'

describe('productKnowledge', () => {
  const items = [
    {
      id: 3,
      title: '胶原修护面霜',
      priceText: '99元',
      promoText: '拍2件减20',
      highlights: ['保湿', '修护屏障', '适合干皮'],
      aliases: ['面霜', '修护霜'],
      faq: [{ q: '适合谁', a: '这款更适合干皮和混干皮哦' }],
    },
  ]

  it('matches explicit slot questions', () => {
    const result = tryProductKnowledgeReply({
      comment: '介绍下三号链接',
      items,
    })

    expect(result.hit).toBe(true)
    expect(result.slotIndex).toBe(3)
    expect(result.matchedFields).toContain('title')
    expect(result.reply).toContain('3号链接')
  })

  it('answers slot-only comments with grounded product knowledge', () => {
    const result = tryProductKnowledgeReply({
      comment: '3号',
      items: [
        {
          id: 3,
          title: '豪园OVITEN 100%椰子水饮料',
          shortTitle: '椰子水',
          priceText: '29.9元',
          highlights: ['100%椰子水', '清爽解腻', '含电解质'],
        },
      ],
    })

    expect(result.hit).toBe(true)
    expect(result.questionType).toBe('general')
    expect(result.reply).toContain('3号链接是椰子水')
    expect(result.reply).toContain('29.9元')
  })

  it('matches keyword questions', () => {
    const result = tryProductKnowledgeReply({
      comment: '这个面霜多少钱',
      items,
    })

    expect(result.hit).toBe(true)
    expect(result.questionType).toBe('price')
    expect(result.reply).toContain('99元')
  })

  it('uses viewer session for reference questions', () => {
    const result = tryProductKnowledgeReply({
      comment: '这个适合谁',
      items,
      viewerSession: {
        slotIndex: 3,
        updatedAt: Date.now(),
      },
    })

    expect(result.hit).toBe(true)
    expect(result.reply).toBe('这款更适合干皮和混干皮哦')
  })

  it('does not hijack non-product compliments', () => {
    const result = tryProductKnowledgeReply({
      comment: '我好喜欢主播啊',
      items,
    })

    expect(result.hit).toBe(false)
  })

  it('returns a miss instead of throwing when comment content is missing', () => {
    const result = tryProductKnowledgeReply({
      comment: undefined,
      items,
    })

    expect(result.hit).toBe(false)
    expect(result.missReason).toBe('not-product-query')
  })

  it('treats inventory questions as stock questions', () => {
    const result = tryProductKnowledgeReply({
      comment: '三号链接还有货吗',
      items: [
        {
          id: 3,
          title: '胶原修护面霜',
          stockText: '现货充足',
        },
      ],
    })

    expect(result.hit).toBe(true)
    expect(result.questionType).toBe('stock')
    expect(result.reply).toContain('现货充足')
  })

  it('returns miss reason when asked slot is not configured', () => {
    const result = tryProductKnowledgeReply({
      comment: '介绍下九号链接',
      items,
    })

    expect(result.hit).toBe(false)
    expect(result.missReason).toBe('slot-not-found')
  })

  it('builds fallback faq from extracted draft fields', () => {
    const faq = buildFallbackFaqFromKnowledgeDraft({
      title: '胶原修护面霜',
      priceText: '99元',
      highlights: ['保湿', '修护屏障'],
    })

    expect(faq).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ q: '这是什么' }),
        expect.objectContaining({ q: '多少钱' }),
        expect.objectContaining({ q: '有什么亮点' }),
      ]),
    )
  })

  it('includes user supplement in product polish prompt', () => {
    const prompt = buildProductKnowledgePolishPrompt({
      comment: '介绍一下3号链接',
      templateReply: '3号这款主打清爽补水',
      item: {
        id: 3,
        title: '胶原修护面霜',
        priceText: '99元',
      },
      userPrompt: '更像主播口播，不要太像客服',
    })

    expect(prompt).toContain('用户补充要求：')
    expect(prompt).toContain('更像主播口播，不要太像客服')
  })

  it('answers product list questions from the real goods list', () => {
    const result = tryProductKnowledgeReply({
      comment: '今天都有什么产品',
      items: [
        {
          id: 1,
          shortTitle: '修护面霜',
        },
        {
          id: 2,
          shortTitle: '舒缓精华',
        },
        {
          id: 3,
          shortTitle: '补水喷雾',
        },
      ],
    })

    expect(result.hit).toBe(true)
    expect(result.questionType).toBe('list')
    expect(result.reply).toContain('1号修护面霜')
    expect(result.reply).toContain('2号舒缓精华')
    expect(result.reply).toContain('3号补水喷雾')
  })

  it('does not invent a featured product when asked about today main push', () => {
    const result = tryProductKnowledgeReply({
      comment: '今天主推什么',
      items,
    })

    expect(result.hit).toBe(true)
    expect(result.questionType).toBe('list')
    expect(result.reply).not.toContain('主推3号')
    expect(result.reply).not.toContain('胶原修护面霜')
  })

  it('returns a safe fallback for product questions when no goods are configured', () => {
    expect(buildSafeProductFallbackReply('今天都有什么产品', [])).toContain('还没配置好')
    expect(buildSafeProductFallbackReply('这个多少钱', [])).toContain('按链接号讲更准确')
  })

  it('guards featured claims and invalid slot references in replies', () => {
    expect(
      validateGroundedProductReply({
        comment: '今天主推什么',
        reply: '今天主推3号链接防晒衣',
        items,
      }).ok,
    ).toBe(false)

    expect(
      validateGroundedProductReply({
        comment: '介绍下三号链接',
        reply: '9号链接是修护面霜',
        items,
        expectedItem: items[0],
      }).ok,
    ).toBe(false)
  })

  it('guards product facts such as other item labels, prices, promo and stock', () => {
    const multiItems = [
      items[0],
      {
        id: 4,
        title: '舒缓精华',
        priceText: '129元',
        promoText: '第二件半价',
        stockText: '现货充足',
        aliases: ['精华'],
      },
    ]

    expect(
      validateGroundedProductReply({
        comment: '介绍下三号链接',
        reply: '3号链接是舒缓精华',
        items: multiItems,
        expectedItem: multiItems[0],
      }).ok,
    ).toBe(false)

    expect(
      validateGroundedProductReply({
        comment: '三号链接多少钱',
        reply: '3号链接现在129元',
        items: multiItems,
        expectedItem: multiItems[0],
      }).ok,
    ).toBe(false)

    expect(
      validateGroundedProductReply({
        comment: '三号链接有什么优惠',
        reply: '3号链接第二件半价',
        items: multiItems,
        expectedItem: multiItems[0],
      }).ok,
    ).toBe(false)

    expect(
      validateGroundedProductReply({
        comment: '三号链接有货吗',
        reply: '3号链接现货充足',
        items: multiItems,
        expectedItem: multiItems[0],
      }).ok,
    ).toBe(false)
  })

  it('guards ungrounded list replies that smuggle in price or stock facts', () => {
    const multiItems = [
      { id: 1, shortTitle: '修护面霜' },
      { id: 2, shortTitle: '舒缓精华' },
    ]

    expect(
      validateGroundedProductReply({
        comment: '今天都有什么产品',
        reply: '今天有1号修护面霜，现在99元',
        items: multiItems,
      }).ok,
    ).toBe(false)

    expect(
      validateGroundedProductReply({
        comment: '今天都有什么产品',
        reply: '今天有1号修护面霜，现货充足',
        items: multiItems,
      }).ok,
    ).toBe(false)
  })

  it('builds a concise product list reply', () => {
    expect(
      buildProductListReply('今天都有什么产品', [
        { id: 1, shortTitle: '修护面霜' },
        { id: 2, shortTitle: '舒缓精华' },
        { id: 3, shortTitle: '补水喷雾' },
        { id: 4, shortTitle: '清洁泥膜' },
      ]),
    ).toBe('今天有1号修护面霜、2号舒缓精华、3号补水喷雾等几款，您想先看哪号')
  })
})
