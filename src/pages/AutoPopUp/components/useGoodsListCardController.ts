import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutoReplyStore } from '@/hooks/autoReplyStore'
import type { AutoReplyContext } from '@/hooks/autoReplyStoreHelpers'
import { useAccounts } from '@/hooks/useAccounts'
import { useAIChatStore } from '@/hooks/useAIChat'
import { useAITrialStore } from '@/hooks/useAITrial'
import {
  type GoodsItemConfig,
  type KnowledgeSampleDecision,
  type KnowledgeSampleDecisionStatus,
  useAutoPopUpActions,
  useCurrentAutoPopUp,
} from '@/hooks/useAutoPopUp'
import { useConnectionStatus, useCurrentPlatform } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { summarizeKnowledgeLoopSamples } from '@/lib/autoReplyInsights'
import { MOCK_GOODS_IDS, shouldUseMockGoods } from '@/utils/mockGoodsData'
import {
  addSampleGoods,
  autoFillGoods,
  clearGoodsList,
  copyKnowledgeTemplate,
  exportGoodsKnowledge,
  importGoodsKnowledge,
  saveGoodsFromText,
  scanGoodsKnowledgeDraft,
  updateGoodsItem,
} from './goodsListCardActions'
import { type GoodsListInitialAssistContext, goodsToText } from './goodsListCardUtils'

type AssistFilter =
  | 'all'
  | 'faq-missing'
  | 'price-stock-missing'
  | 'needs-basics'
  | 'knowledge-good'
  | 'knowledge-review'
  | 'knowledge-gap'

const ASSIST_FILTER_VALUES: AssistFilter[] = [
  'all',
  'faq-missing',
  'price-stock-missing',
  'needs-basics',
  'knowledge-good',
  'knowledge-review',
  'knowledge-gap',
]

type AutoReplyKnowledgeSource = Pick<AutoReplyContext, 'comments' | 'replies'>

const EMPTY_KNOWLEDGE_SAMPLE_DECISIONS: Record<
  string,
  KnowledgeSampleDecision | KnowledgeSampleDecisionStatus
> = {}

const EMPTY_AUTO_REPLY_CONTEXT: AutoReplyKnowledgeSource = {
  comments: [],
  replies: [],
}

function normalizeAssistFilter(filter?: string | null): AssistFilter {
  return ASSIST_FILTER_VALUES.includes(filter as AssistFilter) ? (filter as AssistFilter) : 'all'
}

export function useGoodsListCardController({
  initialEditingGoodsId,
  initialAssistContext,
}: {
  initialEditingGoodsId?: number | null
  initialAssistContext?: GoodsListInitialAssistContext
}) {
  const goods = useCurrentAutoPopUp(context => context.config.goods) ?? []
  const goodsAutoFillAttempted = useCurrentAutoPopUp(
    context => context.goodsAutoFillAttempted ?? false,
  )
  const goodsAutoFillLocked = useCurrentAutoPopUp(context => context.goodsAutoFillLocked ?? false)
  const defaultInterval = useCurrentAutoPopUp(context => context.config.scheduler.interval)
  const knowledgeSampleDecisions = useCurrentAutoPopUp(
    context => context.knowledgeSampleDecisions ?? EMPTY_KNOWLEDGE_SAMPLE_DECISIONS,
  )
  const { setGoods, setGoodsAutoFillState, setKnowledgeSampleDecision } = useAutoPopUpActions()
  const { toast } = useToast()
  const platform = useCurrentPlatform()
  const connectionStatus = useConnectionStatus()
  const { currentAccountId } = useAccounts()
  const provider = useAIChatStore(state => state.config.provider)
  const model = useAIChatStore(state => state.config.model)
  const apiKeys = useAIChatStore(state => state.apiKeys)
  const customBaseURL = useAIChatStore(state => state.customBaseURL)
  const ensureTrialSession = useAITrialStore(state => state.ensureSession)
  const reportTrialUse = useAITrialStore(state => state.reportUse)
  const autoReplyContext: AutoReplyKnowledgeSource =
    useAutoReplyStore(state => state.contexts[currentAccountId]) ?? EMPTY_AUTO_REPLY_CONTEXT
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editingItem, setEditingItem] = useState<GoodsItemConfig | null>(null)
  const [isAutoFilling, setIsAutoFilling] = useState(false)
  const [importText, setImportText] = useState('')
  const [dismissedAssist, setDismissedAssist] = useState(false)
  const [assistFilter, setAssistFilter] = useState<AssistFilter>('all')
  const autoFillRequestRef = useRef(false)

  useEffect(() => {
    void currentAccountId
    setIsEditing(false)
    setInputValue('')
    setEditingItem(null)
    setDismissedAssist(false)
    setAssistFilter(normalizeAssistFilter(initialAssistContext?.filter?.trim()))
    autoFillRequestRef.current = false
  }, [currentAccountId, initialAssistContext?.filter])

  useEffect(() => {
    if (!initialEditingGoodsId) return
    const existing = goods.find(item => item.id === initialEditingGoodsId)
    setEditingItem(existing ?? { id: initialEditingGoodsId })
  }, [goods, initialEditingGoodsId])

  const assistTitle = initialAssistContext?.title?.trim()
  const assistDescription = initialAssistContext?.description?.trim()
  const assistQuestion = initialAssistContext?.sampleQuestion?.trim()
  const assistAnswer = initialAssistContext?.sampleAnswer?.trim()
  const initialAssistFilter = initialAssistContext?.filter?.trim()
  const showAssistWorkbench =
    !dismissedAssist && Boolean(assistTitle || assistDescription || assistQuestion || assistAnswer)

  useEffect(() => {
    if (initialAssistFilter) {
      setAssistFilter(normalizeAssistFilter(initialAssistFilter))
    }
  }, [initialAssistFilter])

  const recentQuestionSamples = useMemo(() => {
    const commentById = new Map(
      autoReplyContext.comments
        .map(comment => {
          const content =
            'content' in comment && typeof comment.content === 'string' ? comment.content : ''
          return [comment.msg_id, content] as const
        })
        .filter(([, content]) => content.trim().length > 0),
    )

    return autoReplyContext.replies
      .filter(reply => reply.matchedSlotIndex && commentById.has(reply.commentId))
      .map(reply => ({
        key: `${reply.matchedSlotIndex}:${reply.commentId}`,
        goodsId: reply.matchedSlotIndex as number,
        commentId: reply.commentId,
        question: commentById.get(reply.commentId)?.trim() ?? '',
        answer: reply.replyContent.trim(),
        isSent: reply.isSent,
        source: reply.source,
        time: reply.time,
        decisionStatus: (() => {
          const decision = knowledgeSampleDecisions[
            `${reply.matchedSlotIndex}:${reply.commentId}`
          ] as KnowledgeSampleDecision | undefined
          return decision?.status
        })(),
        decidedAt: (() => {
          const decision = knowledgeSampleDecisions[
            `${reply.matchedSlotIndex}:${reply.commentId}`
          ] as KnowledgeSampleDecision | undefined
          return decision?.decidedAt
        })(),
      }))
      .filter(sample => sample.question && sample.answer)
      .slice(0, 24)
  }, [autoReplyContext.comments, autoReplyContext.replies, knowledgeSampleDecisions])

  const pendingSampleCountByGoodsId = useMemo(() => {
    const counts = new Map<number, number>()
    for (const sample of recentQuestionSamples) {
      if (sample.decisionStatus) continue
      counts.set(sample.goodsId, (counts.get(sample.goodsId) ?? 0) + 1)
    }
    return counts
  }, [recentQuestionSamples])

  const knowledgeLoopSummary = useMemo(
    () =>
      summarizeKnowledgeLoopSamples(
        recentQuestionSamples.map(sample => ({
          key: sample.key,
          commentId: sample.commentId,
          goodsId: sample.goodsId,
          question: sample.question,
          answer: sample.answer,
          time: sample.time,
          decision: sample.decisionStatus,
          decidedAt: sample.decidedAt,
        })),
      ),
    [recentQuestionSamples],
  )

  const goodsKnowledgeHealthById = useMemo(() => {
    const healthById = new Map<
      number,
      {
        label: '效果好' | '待复查' | '仍有缺口'
        tone: 'emerald' | 'amber' | 'rose'
        description: string
      }
    >()

    const postAdoptionPendingByGoodsId = knowledgeLoopSummary.postAdoptionPendingCounts
    const pendingByGoodsId = knowledgeLoopSummary.pendingSlotCounts
    const adoptedByGoodsId = new Map<number, number>()

    for (const sample of recentQuestionSamples) {
      if (sample.decisionStatus === 'adopted') {
        adoptedByGoodsId.set(sample.goodsId, (adoptedByGoodsId.get(sample.goodsId) ?? 0) + 1)
      }
    }

    for (const item of goods) {
      const goodsId = item.id
      const postAdoptionPending = postAdoptionPendingByGoodsId.get(goodsId) ?? 0
      const pending = pendingByGoodsId.get(goodsId) ?? 0
      const adopted = adoptedByGoodsId.get(goodsId) ?? 0

      if (postAdoptionPending > 0) {
        healthById.set(goodsId, {
          label: '待复查',
          tone: 'amber',
          description: `采纳 FAQ 后又新增 ${postAdoptionPending} 条待处理样本，建议复查问法覆盖。`,
        })
        continue
      }

      if (pending > 0) {
        healthById.set(goodsId, {
          label: '仍有缺口',
          tone: 'rose',
          description: `当前还有 ${pending} 条待处理样本，建议继续补 FAQ 或别名。`,
        })
        continue
      }

      if (adopted > 0) {
        healthById.set(goodsId, {
          label: '效果好',
          tone: 'emerald',
          description: '已采纳 FAQ，且最近没有新增待处理样本。',
        })
      }
    }

    return healthById
  }, [
    goods,
    knowledgeLoopSummary.pendingSlotCounts,
    knowledgeLoopSummary.postAdoptionPendingCounts,
    recentQuestionSamples,
  ])

  const filteredGoods = useMemo(() => {
    switch (assistFilter) {
      case 'faq-missing':
        return goods.filter(item => !item.faq?.length)
      case 'price-stock-missing':
        return goods.filter(item => !item.priceText || !item.stockText)
      case 'needs-basics':
        return goods.filter(item => !item.title || !item.priceText || !item.faq?.length)
      case 'knowledge-good':
        return goods.filter(item => goodsKnowledgeHealthById.get(item.id)?.label === '效果好')
      case 'knowledge-review':
        return goods.filter(item => goodsKnowledgeHealthById.get(item.id)?.label === '待复查')
      case 'knowledge-gap':
        return goods.filter(item => goodsKnowledgeHealthById.get(item.id)?.label === '仍有缺口')
      default:
        return goods
    }
  }, [assistFilter, goods, goodsKnowledgeHealthById])

  const isTestMode = shouldUseMockGoods(platform)
  const showSampleAction = import.meta.env.DEV || platform === 'dev'

  useEffect(() => {
    console.log(
      `[MockGoods] Check: platform=${platform}, isTestMode=${isTestMode}, goods.length=${goods.length}`,
    )
    if (isTestMode && goods.length === 0) {
      console.log(`[MockGoods] Auto-injecting test goods for platform: ${platform}`)
      setGoods(MOCK_GOODS_IDS.map(id => ({ id })))
    }
  }, [isTestMode, goods.length, setGoods, platform])

  const persistManualGoods = useMemoizedFn((nextGoods: GoodsItemConfig[]) => {
    setGoods(nextGoods)
    setGoodsAutoFillState({
      goodsAutoFillAttempted: true,
      goodsAutoFillLocked: true,
    })
  })

  const handleStartEdit = () => {
    setInputValue(goodsToText(goods))
    setIsEditing(true)
  }

  const handleSave = useMemoizedFn(() => {
    saveGoodsFromText({
      inputValue,
      goods,
      persistManualGoods,
      setIsEditing,
      toast,
    })
  })

  const handleCancel = () => {
    setIsEditing(false)
    setInputValue('')
  }

  const handleClear = useMemoizedFn(() => {
    clearGoodsList({
      persistManualGoods,
      setInputValue,
      toast,
    })
  })

  const handleAddSample = useMemoizedFn(() => {
    addSampleGoods({ goods, persistManualGoods, toast })
  })

  const handleImportKnowledge = useMemoizedFn(() => {
    importGoodsKnowledge({
      importText,
      goods,
      persistManualGoods,
      setImportText,
      toast,
    })
  })

  const handleScanKnowledge = useMemoizedFn(async (goodsId: number) => {
    return await scanGoodsKnowledgeDraft({
      goodsId,
      currentAccountId,
      connectionStatus,
      provider,
      model,
      apiKeys,
      customBaseURL,
      ensureTrialSession,
      reportTrialUse,
      toast,
    })
  })

  const handleCopyTemplate = useMemoizedFn(async () => {
    await copyKnowledgeTemplate(toast)
  })

  const handleExportKnowledge = useMemoizedFn(() => {
    exportGoodsKnowledge(goods, toast)
  })

  const handleAutoFill = useMemoizedFn(async (source: 'manual' | 'init' = 'manual') => {
    await autoFillGoods({
      source,
      currentAccountId,
      connectionStatus,
      goods,
      setGoods,
      setGoodsAutoFillState,
      setInputValue,
      setIsEditing,
      setIsAutoFilling,
      autoFillRequestRef,
      toast,
    })
  })

  const handleUpdateItem = useMemoizedFn((updatedItem: GoodsItemConfig) => {
    updateGoodsItem(goods, updatedItem, persistManualGoods, toast)
  })

  useEffect(() => {
    if (goods.length > 0) return
    if (goodsAutoFillAttempted || goodsAutoFillLocked) return
    if (connectionStatus !== 'connected') return
    if (!currentAccountId) return
    if (isAutoFilling || autoFillRequestRef.current) return

    autoFillRequestRef.current = true
    void handleAutoFill('init')
  }, [
    goods.length,
    goodsAutoFillAttempted,
    goodsAutoFillLocked,
    connectionStatus,
    currentAccountId,
    isAutoFilling,
    handleAutoFill,
  ])

  return {
    assistDescription,
    assistFilter,
    assistAnswer,
    assistQuestion,
    assistTitle,
    defaultInterval,
    dismissedAssist,
    editingItem,
    filteredGoods,
    goods,
    handleAddSample,
    handleAutoFill,
    handleCancel,
    handleClear,
    handleCopyTemplate,
    handleExportKnowledge,
    handleImportKnowledge,
    handleSave,
    handleScanKnowledge,
    handleStartEdit,
    handleUpdateItem,
    importText,
    initialEditingGoodsId,
    inputValue,
    isAutoFilling,
    isEditing,
    goodsKnowledgeHealthById,
    pendingSampleCountByGoodsId,
    recentQuestionSamples,
    setKnowledgeSampleDecision,
    setAssistFilter,
    setDismissedAssist,
    setEditingItem,
    setImportText,
    setInputValue,
    setIsEditing,
    showAssistWorkbench,
    showSampleAction,
  }
}
