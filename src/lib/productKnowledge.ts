import type { GoodsItemConfig } from '@/hooks/useAutoPopUp'

export type ProductQuestionType = 'price' | 'stock' | 'usage' | 'general' | 'list'
export type ProductIntent =
  | 'not-product'
  | 'single-product'
  | 'reference-product'
  | 'product-list'
  | 'unknown-product'

export interface ViewerProductSession {
  slotIndex: number
  updatedAt: number
}

export interface ProductKnowledgeHit {
  hit: boolean
  intent?: ProductIntent
  slotIndex?: number
  item?: GoodsItemConfig
  reply?: string
  shouldUpdateSession?: boolean
  questionType?: ProductQuestionType
  matchedFields?: string[]
  missReason?:
    | 'no-items'
    | 'not-product-query'
    | 'slot-not-found'
    | 'reference-expired'
    | 'keyword-not-found'
}

export function buildProductKnowledgePolishPrompt(params: {
  comment: string
  templateReply: string
  item: GoodsItemConfig
  userPrompt?: string
}) {
  const { comment, templateReply, item, userPrompt } = params
  const facts = [
    `链接号：${item.id}`,
    item.title ? `商品标题：${item.title}` : '',
    item.priceText ? `价格信息：${item.priceText}` : '',
    item.promoText ? `优惠信息：${item.promoText}` : '',
    item.stockText ? `库存信息：${item.stockText}` : '',
    item.highlights?.length ? `卖点：${item.highlights.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return [
    '你是直播间商品讲解助手，专门回复“几号链接”相关问题。',
    '你的任务是把已有回复模板润色得更自然、更口语化，但不能改变事实。',
    '回复要像主播口播，短、顺、接地气，不要像客服，不要像商品详情页。',
    '每次只回复一句，18到30字优先，绝不要超过40字。',
    '优先用“几号链接 + 短称呼 + 一个重点”来回答。',
    '不要复述完整商品长标题，不要一条里塞太多信息。',
    '最多只说一个卖点，必要时再补价格或库存，不要编造价格、优惠、库存、功效。',
    '不要使用极限词、强刺激下单话术、抽奖返现等违规表达。',
    '只输出最终回复，不要解释。',
    `用户评论：${comment}`,
    `商品事实：\n${facts}`,
    `原始回复模板：${templateReply}`,
    userPrompt?.trim() ? `用户补充要求：\n${userPrompt.trim()}` : '',
    '请输出简短、自然、可直接发送的最终回复。',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildKnowledgeDraftPrompt(scanResult: {
  id: number
  title?: string
  priceText?: string
  detailText?: string
  source: 'detail-page' | 'list-item'
}) {
  return [
    '你是直播电商商品知识卡整理助手。',
    '请根据给定的商品原始信息，输出一个 JSON 对象，用于自动填写商品知识卡。',
    '不要编造没有出现过的价格、优惠、库存、成分、功效。',
    'highlights 最多输出 5 条，aliases 最多输出 5 条，faq 最多输出 4 条。',
    'faq 请尽量生成 2 到 4 条直播间最常见的问答，优先围绕：这是什么、多少钱、有什么亮点、适合谁。',
    '如果原始信息不足以支持某条 FAQ，就不要编造；但只要能从标题、价格、卖点直接推出，就应该生成。',
    '如果某字段无法确定，就输出空字符串或空数组。',
    '只输出 JSON，不要输出解释。',
    JSON.stringify({
      id: scanResult.id,
      title: scanResult.title ?? '',
      priceText: scanResult.priceText ?? '',
      detailText: scanResult.detailText ?? '',
      source: scanResult.source,
      outputSchema: {
        title: 'string',
        shortTitle: 'string',
        priceText: 'string',
        promoText: 'string',
        stockText: 'string',
        highlights: ['string'],
        aliases: ['string'],
        faq: [{ q: 'string', a: 'string' }],
      },
    }),
  ].join('\n\n')
}

export function parseKnowledgeDraftResponse(text: string): Partial<GoodsItemConfig> | null {
  const fenced = text.replace(/```json|```/g, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as Partial<GoodsItemConfig>
    return {
      title: parsed.title?.trim() || undefined,
      shortTitle: parsed.shortTitle?.trim() || undefined,
      priceText: parsed.priceText?.trim() || undefined,
      promoText: parsed.promoText?.trim() || undefined,
      stockText: parsed.stockText?.trim() || undefined,
      highlights: parsed.highlights?.filter(Boolean).slice(0, 5) ?? [],
      aliases: parsed.aliases?.filter(Boolean).slice(0, 5) ?? [],
      faq:
        parsed.faq
          ?.filter(item => item?.q?.trim() && item?.a?.trim())
          .slice(0, 4)
          .map(item => ({ q: item.q.trim(), a: item.a.trim() })) ?? [],
    }
  } catch {
    return null
  }
}

export function buildFallbackFaqFromKnowledgeDraft(draft: Partial<GoodsItemConfig>) {
  const faq: Array<{ q: string; a: string }> = []

  if (draft.title) {
    faq.push({
      q: '这是什么',
      a: `这款是${draft.title}，可以点链接看详情哦`,
    })
  }

  if (draft.priceText) {
    faq.push({
      q: '多少钱',
      a: `现在${draft.priceText}，具体以链接页显示为准哦`,
    })
  }

  if (draft.highlights?.length) {
    faq.push({
      q: '有什么亮点',
      a: `这款主要是${draft.highlights.slice(0, 3).join('、')}`,
    })
  }

  if (draft.stockText) {
    faq.push({
      q: '还有货吗',
      a: draft.stockText,
    })
  }

  return faq.slice(0, 4)
}

const SLOT_PATTERNS = [
  /([0-9]{1,2})\s*号\s*(?:链接|商品|款)?/i,
  /第\s*([0-9]{1,2})\s*(?:个|款|号)(?:链接|商品)?/i,
  /([一二三四五六七八九十两]{1,3})\s*号\s*(?:链接|商品|款)?/,
  /第\s*([一二三四五六七八九十两]{1,3})\s*(?:个|款|号)(?:链接|商品)?/,
]

const PRODUCT_QUERY_RE =
  /(链接|商品|这款|那个|这个|多少钱|价格|优惠|活动|库存|有货|适合|怎么用|介绍|发货|规格|尺码|成分|功效|材质|颜色|第.+个|几号)/

const PRODUCT_LIST_RE =
  /((今天|现在|目前).*(有什么|有哪些|都有什么|都有哪些|卖什么|上什么|上了什么|有哪些链接|都有哪些链接).*(产品|商品|链接|款)?|(产品|商品|链接|款).*(有什么|有哪些|都有什么|都有哪些)|(主推|重点推|主打款))/i

const REFERENCE_RE = /(这个|那个|它|这款|那款|刚才那个|刚刚那个)/
const PRICE_RE = /(多少|多少钱|价格|优惠|活动|几折|便宜|到手)/
const STOCK_RE = /(有货|库存|还有吗|还能拍|能下单|现货)/
const USAGE_RE = /(怎么用|怎么穿|怎么选|适合|功效|作用|成分|材质|颜色|尺码|规格|介绍|详情)/
const FEATURED_RE = /(主推|重点推|主打款)/
const SLOT_REFERENCE_GLOBAL_RE = /([0-9]{1,2})\s*号\s*链接/gi
const PRICE_SIGNAL_RE = /(¥|￥|\d+\s*元|价格|到手)/
const PROMO_SIGNAL_RE = /(优惠|活动|满减|立减|拍\d+件|拍\d件|券|到手)/
const STOCK_SIGNAL_RE = /(库存|有货|现货|还能拍|能下单|缺货|没货|售罄)/

function chineseNumberToInt(text: string) {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }

  if (text === '十') return 10
  if (text.length === 2 && text.startsWith('十')) {
    return 10 + (map[text[1]] ?? 0)
  }
  if (text.length === 2 && text.endsWith('十')) {
    return (map[text[0]] ?? 0) * 10
  }
  if (text.length === 3 && text[1] === '十') {
    return (map[text[0]] ?? 0) * 10 + (map[text[2]] ?? 0)
  }
  return map[text] ?? Number.NaN
}

function normalizeCommentText(comment: string | null | undefined) {
  if (typeof comment !== 'string') {
    return ''
  }

  return comment.trim()
}

function parseSlotIndex(comment: string | null | undefined) {
  const normalizedComment = normalizeCommentText(comment)
  if (!normalizedComment) {
    return undefined
  }

  for (const pattern of SLOT_PATTERNS) {
    const match = normalizedComment.match(pattern)
    if (!match?.[1]) continue

    const raw = match[1]
    const parsed = /^[0-9]+$/.test(raw) ? Number.parseInt(raw, 10) : chineseNumberToInt(raw)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  return undefined
}

function normalizeText(text: string | null | undefined) {
  return normalizeCommentText(text).toLowerCase()
}

function sliceByChars(text: string, maxChars: number) {
  const chars = Array.from(text.trim())
  if (chars.length <= maxChars) {
    return chars.join('')
  }
  return chars.slice(0, maxChars).join('')
}

function getListItemLabel(item: GoodsItemConfig) {
  const fallbackAlias = item.aliases?.find(alias => normalizeCommentText(alias).length >= 2)
  const base = item.shortTitle || fallbackAlias || item.title || `${item.id}号这款`
  return sliceByChars(base, 8)
}

function getItemLabels(item: GoodsItemConfig) {
  return [item.title, item.shortTitle, ...(item.aliases ?? [])]
    .map(label => normalizeCommentText(label))
    .filter(label => label.length >= 2)
}

export function isProductListQuery(comment: string | null | undefined) {
  return PRODUCT_LIST_RE.test(normalizeCommentText(comment))
}

export function buildSafeProductFallbackReply(
  comment: string | null | undefined,
  items: GoodsItemConfig[] = [],
) {
  const normalizedComment = normalizeCommentText(comment)

  if (!items.length) {
    if (FEATURED_RE.test(normalizedComment)) {
      return '今天商品还在整理中，您想看哪类我先给您介绍'
    }
    if (isProductListQuery(normalizedComment)) {
      return '今天商品还没配置好，您想看哪类我先给您介绍'
    }
    return '这边按链接号讲更准确，您想了解哪一款'
  }

  if (FEATURED_RE.test(normalizedComment)) {
    return '今天上了几款呢，您想先看哪号我给您详细介绍'
  }

  if (isProductListQuery(normalizedComment)) {
    return '今天有几款在上架，您想先看哪号我给您介绍'
  }

  return '这边按链接号讲更准确，您想了解哪一款'
}

export function buildProductListReply(
  comment: string | null | undefined,
  items: GoodsItemConfig[],
) {
  if (items.length === 0) {
    return buildSafeProductFallbackReply(comment, items)
  }

  const normalizedComment = normalizeCommentText(comment)
  if (FEATURED_RE.test(normalizedComment)) {
    return buildSafeProductFallbackReply(normalizedComment, items)
  }

  const orderedItems = [...items].sort((a, b) => a.id - b.id)
  const topItems = orderedItems.slice(0, 3)
  const summary = topItems.map(item => `${item.id}号${getListItemLabel(item)}`).join('、')

  if (orderedItems.length === 1) {
    return `今天先上这1款，${summary}，您想了解我给您细说`
  }

  if (orderedItems.length <= 3) {
    return `今天有${summary}，您想先看哪号`
  }

  return `今天有${summary}等几款，您想先看哪号`
}

function inferProductIntent(params: {
  comment: string
  slotIndex?: number
  keywordMatchedItem?: GoodsItemConfig
}) {
  const { comment, slotIndex, keywordMatchedItem } = params

  if (isProductListQuery(comment)) {
    return 'product-list' satisfies ProductIntent
  }

  if (slotIndex || keywordMatchedItem) {
    return 'single-product' satisfies ProductIntent
  }

  if (REFERENCE_RE.test(comment)) {
    return 'reference-product' satisfies ProductIntent
  }

  if (PRODUCT_QUERY_RE.test(comment)) {
    return 'unknown-product' satisfies ProductIntent
  }

  return 'not-product' satisfies ProductIntent
}

function matchByKeyword(comment: string | null | undefined, items: GoodsItemConfig[]) {
  const normalizedComment = normalizeText(comment)
  if (!normalizedComment) {
    return undefined
  }

  const scored = items
    .map(item => {
      const candidates = [
        item.title,
        item.shortTitle,
        ...(item.aliases ?? []),
        ...(item.highlights ?? []),
      ]
        .filter(Boolean)
        .map(text => text!.trim())

      let score = 0
      for (const candidate of candidates) {
        const normalizedCandidate = normalizeText(candidate)
        if (!normalizedCandidate || normalizedCandidate.length < 2) continue
        if (normalizedComment.includes(normalizedCandidate)) {
          score = Math.max(score, normalizedCandidate.length)
        }
      }

      return { item, score }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.item
}

function matchFaqAnswer(comment: string | null | undefined, item: GoodsItemConfig) {
  const normalizedComment = normalizeText(comment)
  if (!normalizedComment) {
    return undefined
  }

  return item.faq?.find(
    faq =>
      normalizeText(faq.q).includes(normalizedComment) ||
      normalizedComment.includes(normalizeText(faq.q)),
  )?.a
}

function buildFeatureSummary(item: GoodsItemConfig) {
  return item.highlights?.filter(Boolean).slice(0, 3).join('、')
}

function inferMatchedFields(params: {
  item: GoodsItemConfig
  questionType: NonNullable<ProductKnowledgeHit['questionType']>
}) {
  const { item, questionType } = params
  const fields = ['slotIndex']

  if (item.title) fields.push('title')

  switch (questionType) {
    case 'price':
      if (item.priceText) fields.push('priceText')
      if (item.promoText) fields.push('promoText')
      break
    case 'stock':
      if (item.stockText) fields.push('stockText')
      break
    case 'usage':
      if (item.highlights?.length) fields.push('highlights')
      if (item.faq?.length) fields.push('faq')
      if (item.priceText) fields.push('priceText')
      break
    default:
      if (item.highlights?.length) fields.push('highlights')
      if (item.aliases?.length) fields.push('aliases')
  }

  return fields
}

function buildProductReply(comment: string | null | undefined, item: GoodsItemConfig) {
  const normalizedComment = normalizeCommentText(comment)
  if (!normalizedComment) {
    return undefined
  }

  const faqAnswer = matchFaqAnswer(normalizedComment, item)
  if (faqAnswer) {
    return { reply: faqAnswer, questionType: 'usage' as const }
  }

  const title = item.shortTitle || item.title || `${item.id}号链接这款`
  const featureSummary = buildFeatureSummary(item)
  const explicitSlotIndex = parseSlotIndex(normalizedComment)

  if (PRICE_RE.test(normalizedComment)) {
    if (item.priceText && item.promoText) {
      return {
        reply: `${item.id}号链接是${title}，现在${item.priceText}，${item.promoText}，点链接就能看详情哦`,
        questionType: 'price' as const,
      }
    }
    if (item.priceText) {
      return {
        reply: `${item.id}号链接是${title}，现在${item.priceText}，点链接就能看详情哦`,
        questionType: 'price' as const,
      }
    }
  }

  if (STOCK_RE.test(normalizedComment)) {
    if (item.stockText) {
      return {
        reply: `${item.id}号链接${item.stockText}，喜欢的话可以点链接看看哦`,
        questionType: 'stock' as const,
      }
    }
    return {
      reply: `${item.id}号链接现在还挂着呢，点进去就能看实时库存哦`,
      questionType: 'stock' as const,
    }
  }

  if (USAGE_RE.test(normalizedComment) || PRODUCT_QUERY_RE.test(normalizedComment)) {
    if (featureSummary && item.priceText) {
      return {
        reply: `${item.id}号链接是${title}，主打${featureSummary}，现在${item.priceText}`,
        questionType: 'usage' as const,
      }
    }
    if (featureSummary) {
      return {
        reply: `${item.id}号链接是${title}，主打${featureSummary}，可以点链接看详情哦`,
        questionType: 'usage' as const,
      }
    }
    if (item.priceText) {
      return {
        reply: `${item.id}号链接是${title}，现在${item.priceText}，可以点链接看看详情哦`,
        questionType: 'usage' as const,
      }
    }
    return {
      reply: `${item.id}号链接是${title}，可以点开链接先看看详情，有想了解的我再帮你介绍`,
      questionType: 'general' as const,
    }
  }

  // 观众只发“3号”“三号链接”这类报号时，也要直接回商品知识库，
  // 不能掉进 AI 通用回复，否则会串到上一轮其他商品的语境。
  if (explicitSlotIndex) {
    if (featureSummary && item.priceText) {
      return {
        reply: `${item.id}号链接是${title}，主打${featureSummary}，现在${item.priceText}`,
        questionType: 'general' as const,
      }
    }
    if (featureSummary) {
      return {
        reply: `${item.id}号链接是${title}，主打${featureSummary}，点链接看详情哦`,
        questionType: 'general' as const,
      }
    }
    if (item.priceText) {
      return {
        reply: `${item.id}号链接是${title}，现在${item.priceText}，点链接看详情哦`,
        questionType: 'general' as const,
      }
    }
    return {
      reply: `${item.id}号链接是${title}，点链接就能看详情哦`,
      questionType: 'general' as const,
    }
  }

  return undefined
}

export function tryProductKnowledgeReply(params: {
  comment?: string | null
  items: GoodsItemConfig[]
  viewerSession?: ViewerProductSession
}) {
  const { comment, items, viewerSession } = params
  const normalizedComment = normalizeCommentText(comment)

  if (items.length === 0) {
    return {
      hit: false,
      intent: inferProductIntent({ comment: normalizedComment, slotIndex: undefined }),
      missReason: 'no-items',
    } satisfies ProductKnowledgeHit
  }

  if (!normalizedComment) {
    return {
      hit: false,
      intent: 'not-product',
      missReason: 'not-product-query',
    } satisfies ProductKnowledgeHit
  }

  const slotIndex = parseSlotIndex(normalizedComment)
  const keywordMatchedItem = matchByKeyword(normalizedComment, items)
  const intent = inferProductIntent({
    comment: normalizedComment,
    slotIndex,
    keywordMatchedItem,
  })

  if (intent === 'product-list') {
    return {
      hit: true,
      intent,
      reply: buildProductListReply(normalizedComment, items),
      questionType: 'list',
      matchedFields: ['goodsList'],
      shouldUpdateSession: false,
    } satisfies ProductKnowledgeHit
  }

  let item =
    (slotIndex ? items.find(candidate => candidate.id === slotIndex) : undefined) ??
    keywordMatchedItem
  let missReason: ProductKnowledgeHit['missReason'] | undefined =
    slotIndex && !item ? 'slot-not-found' : keywordMatchedItem ? undefined : 'keyword-not-found'

  if (
    !item &&
    REFERENCE_RE.test(normalizedComment) &&
    viewerSession &&
    Date.now() - viewerSession.updatedAt < 5 * 60 * 1000
  ) {
    const sessionMatchedItem = items.find(candidate => candidate.id === viewerSession.slotIndex)
    if (sessionMatchedItem) {
      item = sessionMatchedItem
      missReason = undefined
    }
  }

  if (
    !item &&
    REFERENCE_RE.test(normalizedComment) &&
    viewerSession &&
    Date.now() - viewerSession.updatedAt >= 5 * 60 * 1000
  ) {
    missReason = 'reference-expired'
  }

  if (!item) {
    return {
      hit: false,
      intent,
      slotIndex,
      missReason,
    } satisfies ProductKnowledgeHit
  }

  if (
    !slotIndex &&
    !PRODUCT_QUERY_RE.test(normalizedComment) &&
    !REFERENCE_RE.test(normalizedComment)
  ) {
    return {
      hit: false,
      intent: 'not-product',
      missReason: 'not-product-query',
    } satisfies ProductKnowledgeHit
  }

  const productReply = buildProductReply(normalizedComment, item)

  const questionType = productReply?.questionType ?? 'general'

  return {
    hit: true,
    intent,
    slotIndex: item.id,
    item,
    reply: productReply?.reply,
    questionType,
    matchedFields: inferMatchedFields({ item, questionType }),
    shouldUpdateSession: true,
  } satisfies ProductKnowledgeHit
}

function extractReplySlotIndices(reply: string) {
  const slotIndices = new Set<number>()

  for (const match of reply.matchAll(SLOT_REFERENCE_GLOBAL_RE)) {
    const raw = match[1]
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      slotIndices.add(parsed)
    }
  }

  return [...slotIndices]
}

function containsAnyLabel(reply: string, labels: string[]) {
  const normalizedReply = normalizeText(reply)
  return labels.some(label => normalizedReply.includes(normalizeText(label)))
}

export function validateGroundedProductReply(params: {
  comment: string | null | undefined
  reply: string
  items: GoodsItemConfig[]
  expectedItem?: GoodsItemConfig
}) {
  const { comment, reply, items, expectedItem } = params
  const normalizedReply = normalizeCommentText(reply)

  if (!normalizedReply) {
    return {
      ok: false,
      safeReply: buildSafeProductFallbackReply(comment, items),
      reason: 'empty-reply',
    } as const
  }

  if (FEATURED_RE.test(normalizedReply)) {
    return {
      ok: false,
      safeReply: buildSafeProductFallbackReply(comment, items),
      reason: 'featured-claim',
    } as const
  }

  const replySlotIndices = extractReplySlotIndices(normalizedReply)
  const otherItems = expectedItem ? items.filter(item => item.id !== expectedItem.id) : []
  const otherLabels = otherItems.flatMap(getItemLabels)

  if (expectedItem) {
    const hasUnexpectedSlot = replySlotIndices.some(slotIndex => slotIndex !== expectedItem.id)
    if (hasUnexpectedSlot) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'slot-mismatch',
      } as const
    }

    if (containsAnyLabel(normalizedReply, otherLabels)) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'other-item-label',
      } as const
    }

    const otherPriceTexts = otherItems
      .map(item => normalizeCommentText(item.priceText))
      .filter(Boolean)
    if (containsAnyLabel(normalizedReply, otherPriceTexts)) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'other-item-price',
      } as const
    }

    const otherPromoTexts = otherItems
      .map(item => normalizeCommentText(item.promoText))
      .filter(Boolean)
    if (containsAnyLabel(normalizedReply, otherPromoTexts)) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'other-item-promo',
      } as const
    }

    const otherStockTexts = otherItems
      .map(item => normalizeCommentText(item.stockText))
      .filter(Boolean)
    if (containsAnyLabel(normalizedReply, otherStockTexts)) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'other-item-stock',
      } as const
    }

    const expectedPriceText = normalizeCommentText(expectedItem.priceText)
    if (PRICE_SIGNAL_RE.test(normalizedReply)) {
      if (
        !expectedPriceText ||
        !normalizeText(normalizedReply).includes(normalizeText(expectedPriceText))
      ) {
        return {
          ok: false,
          safeReply: buildSafeProductFallbackReply(comment, items),
          reason: 'price-mismatch',
        } as const
      }
    }

    const expectedPromoText = normalizeCommentText(expectedItem.promoText)
    if (PROMO_SIGNAL_RE.test(normalizedReply)) {
      if (
        !expectedPromoText ||
        !normalizeText(normalizedReply).includes(normalizeText(expectedPromoText))
      ) {
        return {
          ok: false,
          safeReply: buildSafeProductFallbackReply(comment, items),
          reason: 'promo-mismatch',
        } as const
      }
    }

    const expectedStockText = normalizeCommentText(expectedItem.stockText)
    if (STOCK_SIGNAL_RE.test(normalizedReply)) {
      if (
        !expectedStockText ||
        !normalizeText(normalizedReply).includes(normalizeText(expectedStockText))
      ) {
        return {
          ok: false,
          safeReply: buildSafeProductFallbackReply(comment, items),
          reason: 'stock-mismatch',
        } as const
      }
    }
  } else {
    const validSlotSet = new Set(items.map(item => item.id))
    const hasInvalidSlot = replySlotIndices.some(slotIndex => !validSlotSet.has(slotIndex))
    if (hasInvalidSlot) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'slot-not-found',
      } as const
    }

    if (
      PRICE_SIGNAL_RE.test(normalizedReply) ||
      PROMO_SIGNAL_RE.test(normalizedReply) ||
      STOCK_SIGNAL_RE.test(normalizedReply)
    ) {
      return {
        ok: false,
        safeReply: buildSafeProductFallbackReply(comment, items),
        reason: 'unguarded-facts',
      } as const
    }
  }

  return {
    ok: true,
  } as const
}
