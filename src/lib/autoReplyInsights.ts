export interface AutoReplyInsightComment {
  msg_id: string
  content?: string
  nick_name: string
}

export interface AutoReplyInsightReply {
  commentId: string
  replyContent: string
  replyIntent?: string
  factStatus?: 'grounded' | 'missing' | 'not-applicable'
  guardrailAction?: 'pass' | 'rewrite'
  guardrailReason?: string
  knowledgeMissReason?: string
  matchedSlotIndex?: number
  autoSendBlockedReason?: string
}

export interface AutoReplyOptimizationSuggestion {
  kind: 'build-kb' | 'alias-faq' | 'missing-slot' | 'price-promo-stock' | 'featured-config'
  title: string
  description: string
  slotIndex?: number
  sampleQuestion?: string
}

export interface AutoReplyKnowledgeLoopSample {
  key: string
  commentId: string
  goodsId: number
  question: string
  answer: string
  time: string
  decision?: 'adopted' | 'dismissed'
  decidedAt?: string
}

export function summarizeKnowledgeLoopSamples(samples: AutoReplyKnowledgeLoopSample[]) {
  const pendingSamples = samples.filter(sample => !sample.decision)
  const adoptedSamples = samples.filter(sample => sample.decision === 'adopted')
  const dismissedSamples = samples.filter(sample => sample.decision === 'dismissed')

  const pendingSlotCounts = new Map<number, number>()
  for (const sample of pendingSamples) {
    pendingSlotCounts.set(sample.goodsId, (pendingSlotCounts.get(sample.goodsId) ?? 0) + 1)
  }

  const topPendingGoods = [...pendingSlotCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const latestAdoptedAtByGoods = new Map<number, number>()
  for (const sample of adoptedSamples) {
    const adoptedAt = new Date(sample.decidedAt || 0).getTime()
    if (!Number.isFinite(adoptedAt) || adoptedAt <= 0) {
      continue
    }
    latestAdoptedAtByGoods.set(
      sample.goodsId,
      Math.max(latestAdoptedAtByGoods.get(sample.goodsId) ?? 0, adoptedAt),
    )
  }

  const postAdoptionPendingCounts = new Map<number, number>()
  for (const sample of pendingSamples) {
    const adoptedAt = latestAdoptedAtByGoods.get(sample.goodsId)
    const sampleAt = new Date(sample.time || 0).getTime()
    if (!adoptedAt || !Number.isFinite(sampleAt) || sampleAt <= adoptedAt) {
      continue
    }
    postAdoptionPendingCounts.set(
      sample.goodsId,
      (postAdoptionPendingCounts.get(sample.goodsId) ?? 0) + 1,
    )
  }

  const topPostAdoptionPendingGoods = [...postAdoptionPendingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const adoptedGoodsIds = new Set(adoptedSamples.map(sample => sample.goodsId))
  let stabilizedGoodsCount = 0
  for (const goodsId of adoptedGoodsIds) {
    if (!postAdoptionPendingCounts.has(goodsId)) {
      stabilizedGoodsCount += 1
    }
  }

  const recentHandledSamples = [...samples]
    .filter(sample => Boolean(sample.decision))
    .sort(
      (a, b) =>
        new Date(b.decidedAt || b.time || 0).getTime() -
        new Date(a.decidedAt || a.time || 0).getTime(),
    )
    .slice(0, 5)

  return {
    totalSamples: samples.length,
    pendingCount: pendingSamples.length,
    adoptedCount: adoptedSamples.length,
    dismissedCount: dismissedSamples.length,
    stabilizedGoodsCount,
    topPendingGoods,
    topPostAdoptionPendingGoods,
    recentHandledSamples,
    pendingSlotCounts,
    postAdoptionPendingCounts,
  }
}

export function buildAutoReplyAnomalyInsights(
  comments: AutoReplyInsightComment[],
  replies: AutoReplyInsightReply[],
) {
  const anomalyReplies = replies.filter(reply => {
    const isChatLike = reply.replyIntent === 'chat' || reply.replyIntent === 'not-product'
    if (isChatLike) {
      return false
    }

    return (
      reply.guardrailAction === 'rewrite' ||
      reply.factStatus === 'missing' ||
      Boolean(reply.knowledgeMissReason)
    )
  })

  const guardrailReasonCounts = new Map<string, number>()
  const knowledgeMissCounts = new Map<string, number>()
  const replyIntentCounts = new Map<string, number>()
  const slotMissCounts = new Map<number, number>()
  const autoSendBlockedCounts = new Map<string, number>()

  for (const reply of anomalyReplies) {
    if (reply.guardrailReason) {
      guardrailReasonCounts.set(
        reply.guardrailReason,
        (guardrailReasonCounts.get(reply.guardrailReason) ?? 0) + 1,
      )
    }
    if (reply.knowledgeMissReason) {
      knowledgeMissCounts.set(
        reply.knowledgeMissReason,
        (knowledgeMissCounts.get(reply.knowledgeMissReason) ?? 0) + 1,
      )
    }
    if (reply.replyIntent) {
      replyIntentCounts.set(reply.replyIntent, (replyIntentCounts.get(reply.replyIntent) ?? 0) + 1)
    }
    if (reply.knowledgeMissReason === 'slot-not-found' && reply.matchedSlotIndex) {
      slotMissCounts.set(
        reply.matchedSlotIndex,
        (slotMissCounts.get(reply.matchedSlotIndex) ?? 0) + 1,
      )
    }
  }

  for (const reply of replies) {
    if (reply.autoSendBlockedReason) {
      autoSendBlockedCounts.set(
        reply.autoSendBlockedReason,
        (autoSendBlockedCounts.get(reply.autoSendBlockedReason) ?? 0) + 1,
      )
    }
  }

  const topGuardrailReasons = [...guardrailReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const topKnowledgeMissReasons = [...knowledgeMissCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const topReplyIntents = [...replyIntentCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const topAutoSendBlockedReasons = [...autoSendBlockedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const anomalySamples = anomalyReplies.slice(0, 5).map(reply => {
    const relatedComment = comments.find(comment => comment.msg_id === reply.commentId)
    return {
      commentId: reply.commentId,
      nickname: relatedComment?.nick_name ?? '',
      commentContent: relatedComment?.content ?? '',
      replyContent: reply.replyContent,
      guardrailReason: reply.guardrailReason,
      knowledgeMissReason: reply.knowledgeMissReason,
      replyIntent: reply.replyIntent,
      matchedSlotIndex: reply.matchedSlotIndex,
      autoSendBlockedReason: reply.autoSendBlockedReason,
    }
  })

  const suggestions: AutoReplyOptimizationSuggestion[] = []

  const noItemsCount = knowledgeMissCounts.get('no-items') ?? 0
  if (noItemsCount > 0) {
    suggestions.push({
      kind: 'build-kb',
      title: '先建立商品知识卡',
      description: `有 ${noItemsCount} 条异常样本因为当前没有商品知识卡，建议先补商品标题、价格和 FAQ。`,
    })
  }

  const keywordMissCount = knowledgeMissCounts.get('keyword-not-found') ?? 0
  const keywordMissSample = anomalySamples.find(
    sample => sample.knowledgeMissReason === 'keyword-not-found',
  )
  if (keywordMissCount > 0) {
    suggestions.push({
      kind: 'alias-faq',
      title: '补商品别名或 FAQ',
      description: keywordMissSample?.commentContent
        ? `像“${keywordMissSample.commentContent}”这类问法没命中知识库，建议补商品别名或常见问答。`
        : `有 ${keywordMissCount} 条样本未命中商品关键词，建议补商品别名或 FAQ。`,
      sampleQuestion: keywordMissSample?.commentContent,
    })
  }

  for (const [slotIndex, count] of [...slotMissCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)) {
    const slotSample = anomalySamples.find(sample => sample.matchedSlotIndex === slotIndex)
    suggestions.push({
      kind: 'missing-slot',
      title: `补充 ${slotIndex} 号链接`,
      description: `有 ${count} 条异常样本提到了 ${slotIndex} 号链接，但当前没有对应知识卡。`,
      slotIndex,
      sampleQuestion: slotSample?.commentContent,
    })
  }

  const factFieldReasons = [
    'price-mismatch',
    'promo-mismatch',
    'stock-mismatch',
    'other-item-price',
    'other-item-promo',
    'other-item-stock',
  ]
  const factFieldIssueCount = factFieldReasons.reduce(
    (sum, reason) => sum + (guardrailReasonCounts.get(reason) ?? 0),
    0,
  )
  if (factFieldIssueCount > 0) {
    suggestions.push({
      kind: 'price-promo-stock',
      title: '补齐价格/优惠/库存字段',
      description: `有 ${factFieldIssueCount} 条异常样本涉及价格、优惠或库存事实不一致，建议补齐商品卡字段。`,
    })
  }

  const featuredClaimCount = guardrailReasonCounts.get('featured-claim') ?? 0
  if (featuredClaimCount > 0) {
    suggestions.push({
      kind: 'featured-config',
      title: '补主推商品配置',
      description: `有 ${featuredClaimCount} 条异常样本提到了“主推”，建议补真实主推来源后再放开相关话术。`,
    })
  }

  const autoSendBlockedCount = replies.filter(reply => Boolean(reply.autoSendBlockedReason)).length

  return {
    anomalyCount: anomalyReplies.length,
    rewrittenCount: replies.filter(reply => reply.guardrailAction === 'rewrite').length,
    missingFactCount: replies.filter(reply => reply.factStatus === 'missing').length,
    knowledgeFallbackCount: replies.filter(reply => Boolean(reply.knowledgeMissReason)).length,
    autoSendBlockedCount,
    topGuardrailReasons,
    topKnowledgeMissReasons,
    topReplyIntents,
    topAutoSendBlockedReasons,
    anomalySamples,
    suggestions: suggestions.slice(0, 5),
  }
}

export function buildAutoReplyKnowledgeLoopInsights(params: {
  comments: AutoReplyInsightComment[]
  replies: Array<
    AutoReplyInsightReply & {
      time?: string
      isSent?: boolean
      source?: 'ai' | 'product-kb' | 'manual'
    }
  >
  decisions?: Record<
    string,
    | 'adopted'
    | 'dismissed'
    | {
        status: 'adopted' | 'dismissed'
        decidedAt?: string
      }
  >
}) {
  const { comments, replies, decisions = {} } = params

  const commentById = new Map(
    comments
      .map(comment => [comment.msg_id, comment.content?.trim() ?? ''] as const)
      .filter(([, content]) => content.length > 0),
  )

  const samples: AutoReplyKnowledgeLoopSample[] = replies
    .filter(reply => reply.matchedSlotIndex && commentById.has(reply.commentId))
    .map(reply => {
      const goodsId = reply.matchedSlotIndex as number
      const key = `${goodsId}:${reply.commentId}`
      return {
        key,
        commentId: reply.commentId,
        goodsId,
        question: commentById.get(reply.commentId) ?? '',
        answer: reply.replyContent.trim(),
        time: reply.time ?? '',
        decision: typeof decisions[key] === 'string' ? decisions[key] : decisions[key]?.status,
        decidedAt: typeof decisions[key] === 'string' ? '' : decisions[key]?.decidedAt,
      }
    })
    .filter(sample => sample.question.length > 0 && sample.answer.length > 0)

  return summarizeKnowledgeLoopSamples(samples)
}
