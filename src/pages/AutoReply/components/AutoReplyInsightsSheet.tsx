import { ChevronDown, Download, FileBarChart2, FileJson2, FolderOpen, Trash2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import type { useAutoReply } from '@/hooks/useAutoReply'
import {
  buildAutoReplyAnomalyInsights,
  buildAutoReplyKnowledgeLoopInsights,
} from '@/lib/autoReplyInsights'
import {
  type AutoReplyExportData,
  type AutoReplyExportRow,
  exportAutoReplyData,
  openAutoReplyExportFolder,
} from '@/utils/exportAutoReply'

type Reply = ReturnType<typeof useAutoReply>['replies'][number]
type Comment = ReturnType<typeof useAutoReply>['comments'][number]

interface AutoReplyInsightsSheetProps {
  accountName: string | null
  currentAccountId: string
  comments: Comment[]
  replies: Reply[]
  historySessions: ReturnType<typeof useAutoReply>['historySessions']
  currentSessionId: string | null
  currentSessionStartedAt: string | null
  currentSessionEndedAt: string | null
  clearHistory: () => void
  onLocateComment: (commentId: string) => void
  toast: ReturnType<typeof import('@/hooks/useToast').useToast>['toast']
  triggerClassName?: string
}

type SessionOption = {
  key: string
  label: string
  comments: Comment[]
  replies: Reply[]
  sessionStartedAt?: string
  sessionEndedAt?: string
}

const missReasonLabelMap: Record<
  'no-items' | 'not-product-query' | 'slot-not-found' | 'reference-expired' | 'keyword-not-found',
  string
> = {
  'no-items': '当前未配置商品知识卡',
  'not-product-query': '普通闲聊，未走商品知识库',
  'slot-not-found': '提到的链接号未配置',
  'reference-expired': '商品指代已过期',
  'keyword-not-found': '未匹配到商品关键词',
}

const replyIntentLabelMap: Record<
  | 'chat'
  | 'not-product'
  | 'single-product'
  | 'reference-product'
  | 'product-list'
  | 'unknown-product',
  string
> = {
  chat: '闲聊回复',
  'not-product': '普通闲聊',
  'single-product': '单商品问答',
  'reference-product': '追问场景',
  'product-list': '商品清单',
  'unknown-product': '商品意图未命中',
}

const guardrailReasonLabelMap: Record<string, string> = {
  'safe-fallback': '商品事实不足，已切换安全回复',
  'featured-claim': '拦截了未经确认的主推表述',
  'slot-mismatch': '拦截了错误链接号',
  'slot-not-found': '拦截了不存在的链接号',
  'other-item-label': '拦截了其他商品名称',
  'other-item-price': '拦截了其他商品价格',
  'other-item-promo': '拦截了其他商品优惠',
  'other-item-stock': '拦截了其他商品库存',
  'price-mismatch': '拦截了未落地的价格信息',
  'promo-mismatch': '拦截了未落地的优惠信息',
  'stock-mismatch': '拦截了未落地的库存信息',
  'unguarded-facts': '拦截了未确认的商品事实',
  'empty-reply': '回复为空，已切安全回复',
}

const autoSendBlockedReasonLabelMap: Record<
  'after-sales' | 'private-contact' | 'medical-sensitive' | 'abuse-conflict' | 'reply-compliance',
  string
> = {
  'after-sales': '售后/投诉问题',
  'private-contact': '联系方式/私聊问题',
  'medical-sensitive': '医疗或功效敏感问题',
  'abuse-conflict': '冲突或负面评论',
  'reply-compliance': '回复命中合规拦截',
}

export default function AutoReplyInsightsSheet({
  accountName,
  currentAccountId,
  comments,
  replies,
  historySessions,
  currentSessionId,
  currentSessionStartedAt,
  currentSessionEndedAt,
  clearHistory,
  onLocateComment,
  toast,
  triggerClassName,
}: AutoReplyInsightsSheetProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>('current')
  const [overviewOpen, setOverviewOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('auto-reply-insights:overview') !== 'closed'
  })
  const [anomalyOpen, setAnomalyOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('auto-reply-insights:anomaly') !== 'closed'
  })
  const [suggestionsOpen, setSuggestionsOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('auto-reply-insights:suggestions') !== 'closed'
  })
  const [knowledgeLoopOpen, setKnowledgeLoopOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('auto-reply-insights:knowledge-loop') !== 'closed'
  })
  const [showAllAnomalySamples, setShowAllAnomalySamples] = useState(false)
  const knowledgeSampleDecisions = useCurrentAutoPopUp(
    context => context.knowledgeSampleDecisions ?? {},
  )

  const navigateToKnowledgeWorkbench = useCallback(
    (params: {
      slotIndex?: number
      title: string
      description: string
      sampleQuestion?: string
      sampleAnswer?: string
      assistFilter?: string
    }) => {
      const searchParams = new URLSearchParams()
      if (params.slotIndex) {
        searchParams.set('editGoodsId', String(params.slotIndex))
      }
      searchParams.set('assistTitle', params.title)
      searchParams.set('assistDescription', params.description)
      if (params.sampleQuestion) {
        searchParams.set('assistQuestion', params.sampleQuestion)
      }
      if (params.sampleAnswer) {
        searchParams.set('assistAnswer', params.sampleAnswer)
      }
      if (params.assistFilter) {
        searchParams.set('assistFilter', params.assistFilter)
      }
      navigate(`/auto-popup?${searchParams.toString()}`)
    },
    [navigate],
  )

  const sessionOptions = useMemo<SessionOption[]>(() => {
    const formatLabelTime = (time?: string | null) => {
      if (!time) return '未开始'
      return new Date(time).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    return [
      {
        key: 'current',
        label: `当前场次 · ${formatLabelTime(currentSessionStartedAt)}`,
        comments,
        replies,
        sessionStartedAt: currentSessionStartedAt ?? undefined,
        sessionEndedAt: currentSessionEndedAt ?? undefined,
      },
      {
        key: 'all',
        label: `全部场次 · ${historySessions.length + 1}个`,
        comments: [...historySessions.flatMap(session => session.comments), ...comments],
        replies: [...historySessions.flatMap(session => session.replies), ...replies],
      },
      ...historySessions.map(session => ({
        key: session.sessionId,
        label: `历史场次 · ${formatLabelTime(session.startedAt)} · ${session.replies.length}条回复`,
        comments: session.comments,
        replies: session.replies,
        sessionStartedAt: session.startedAt,
        sessionEndedAt: session.endedAt,
      })),
    ]
  }, [comments, currentSessionEndedAt, currentSessionStartedAt, historySessions, replies])

  const activeSession =
    sessionOptions.find(option => option.key === selectedSessionKey) ?? sessionOptions[0]
  const displayedComments = activeSession?.comments ?? []
  const displayedReplies = activeSession?.replies ?? []
  const hasAnyHistory =
    comments.length > 0 ||
    replies.length > 0 ||
    historySessions.some(session => session.replies.length > 0)

  useEffect(() => {
    if (!sessionOptions.some(option => option.key === selectedSessionKey)) {
      setSelectedSessionKey('current')
    }
  }, [selectedSessionKey, sessionOptions])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auto-reply-insights:overview', overviewOpen ? 'open' : 'closed')
    }
  }, [overviewOpen])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auto-reply-insights:anomaly', anomalyOpen ? 'open' : 'closed')
    }
  }, [anomalyOpen])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auto-reply-insights:suggestions', suggestionsOpen ? 'open' : 'closed')
    }
  }, [suggestionsOpen])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'auto-reply-insights:knowledge-loop',
        knowledgeLoopOpen ? 'open' : 'closed',
      )
    }
  }, [knowledgeLoopOpen])

  const knowledgeStats = useMemo(() => {
    const total = displayedReplies.length
    const kbHits = displayedReplies.filter(reply => reply.source === 'product-kb').length
    const faqHits = displayedReplies.filter(
      reply => reply.source === 'product-kb' && reply.matchedFields?.includes('faq'),
    ).length
    const hitRate = total > 0 ? Math.round((kbHits / total) * 100) : 0
    const faqHitRate = kbHits > 0 ? Math.round((faqHits / kbHits) * 100) : 0
    const rewrittenCount = displayedReplies.filter(
      reply => reply.guardrailAction === 'rewrite',
    ).length

    const missReasonCounts = new Map<string, number>()
    const slotCounts = new Map<number, number>()

    for (const reply of displayedReplies) {
      if (reply.knowledgeMissReason) {
        missReasonCounts.set(
          reply.knowledgeMissReason,
          (missReasonCounts.get(reply.knowledgeMissReason) ?? 0) + 1,
        )
      }
      if (reply.matchedSlotIndex) {
        slotCounts.set(reply.matchedSlotIndex, (slotCounts.get(reply.matchedSlotIndex) ?? 0) + 1)
      }
    }

    const topMissReason = [...missReasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.at(0) as
      | keyof typeof missReasonLabelMap
      | undefined
    const topSlot = [...slotCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

    return {
      total,
      kbHits,
      hitRate,
      faqHits,
      faqHitRate,
      rewrittenCount,
      topMissReason,
      topSlot,
    }
  }, [displayedReplies])

  const anomalyInsights = useMemo(
    () => buildAutoReplyAnomalyInsights(displayedComments, displayedReplies),
    [displayedComments, displayedReplies],
  )
  const knowledgeLoopInsights = useMemo(
    () =>
      buildAutoReplyKnowledgeLoopInsights({
        comments: displayedComments,
        replies: displayedReplies,
        decisions: knowledgeSampleDecisions,
      }),
    [displayedComments, displayedReplies, knowledgeSampleDecisions],
  )

  const topAnomalyIntentKey = anomalyInsights.topReplyIntents[0]?.[0] as
    | keyof typeof replyIntentLabelMap
    | undefined
  const displayedAnomalySamples = showAllAnomalySamples
    ? anomalyInsights.anomalySamples
    : anomalyInsights.anomalySamples.slice(0, 5)

  const suggestionFilterMap: Record<string, string | undefined> = {
    'build-kb': 'needs-basics',
    'alias-faq': 'faq-missing',
    'missing-slot': 'missing-slot',
    'price-promo-stock': 'price-stock-missing',
    'featured-config': 'needs-basics',
  }
  const postAdoptionPendingGoodsSet = useMemo(
    () => new Set(knowledgeLoopInsights.topPostAdoptionPendingGoods.map(([goodsId]) => goodsId)),
    [knowledgeLoopInsights.topPostAdoptionPendingGoods],
  )

  const getKnowledgeHealthAssistFilter = useCallback(
    (goodsId: number): 'knowledge-gap' | 'knowledge-review' => {
      return postAdoptionPendingGoodsSet.has(goodsId) ? 'knowledge-review' : 'knowledge-gap'
    },
    [postAdoptionPendingGoodsSet],
  )

  const knowledgeGovernanceSummary = useMemo(() => {
    const goodsSummary = Array.from(
      new Set([
        ...knowledgeLoopInsights.topPendingGoods.map(([goodsId]) => goodsId),
        ...knowledgeLoopInsights.topPostAdoptionPendingGoods.map(([goodsId]) => goodsId),
        ...knowledgeLoopInsights.recentHandledSamples.map(sample => sample.goodsId),
      ]),
    )
      .map(goodsId => {
        const pendingSamples = knowledgeLoopInsights.pendingSlotCounts.get(goodsId) ?? 0
        const postAdoptionPendingSamples =
          knowledgeLoopInsights.postAdoptionPendingCounts.get(goodsId) ?? 0
        const adoptedSamples = knowledgeLoopInsights.recentHandledSamples.filter(
          sample => sample.goodsId === goodsId && sample.decision === 'adopted',
        ).length

        if (postAdoptionPendingSamples > 0) {
          return {
            goodsId,
            status: '待复查' as const,
            pendingSamples,
            postAdoptionPendingSamples,
            adoptedSamples,
            description: `采纳 FAQ 后又新增 ${postAdoptionPendingSamples} 条待处理样本。`,
          }
        }

        if (pendingSamples > 0) {
          return {
            goodsId,
            status: '仍有缺口' as const,
            pendingSamples,
            postAdoptionPendingSamples,
            adoptedSamples,
            description: `当前还有 ${pendingSamples} 条待处理样本。`,
          }
        }

        return {
          goodsId,
          status: '效果好' as const,
          pendingSamples,
          postAdoptionPendingSamples,
          adoptedSamples,
          description: '已采纳 FAQ，且最近没有新增待处理样本。',
        }
      })
      .sort((a, b) => a.goodsId - b.goodsId)

    return {
      pendingCount: knowledgeLoopInsights.pendingCount,
      adoptedCount: knowledgeLoopInsights.adoptedCount,
      dismissedCount: knowledgeLoopInsights.dismissedCount,
      stabilizedGoodsCount: knowledgeLoopInsights.stabilizedGoodsCount,
      goodsSummary,
    }
  }, [knowledgeLoopInsights])

  const exportData = useMemo<AutoReplyExportData>(() => {
    const buildRowsFromSession = (params: {
      sessionId?: string
      sessionStartedAt?: string
      sessionEndedAt?: string
      comments: Comment[]
      replies: Reply[]
    }) => {
      const { sessionId, sessionStartedAt, sessionEndedAt, comments, replies } = params
      const replyByCommentId = new Map(replies.map(reply => [reply.commentId, reply]))

      return [
        ...comments.map(comment => {
          const reply = replyByCommentId.get(comment.msg_id)
          const commentContent =
            'content' in comment && typeof comment.content === 'string' ? comment.content : ''

          return {
            sessionId,
            sessionStartedAt,
            sessionEndedAt,
            commentId: comment.msg_id,
            commentTime: comment.time,
            nickname: comment.nick_name,
            commentContent,
            replyTime: reply?.time,
            replyContent: reply?.replyContent,
            isSent: reply?.isSent ?? false,
            source: (reply?.source ?? 'none') as AutoReplyExportRow['source'],
            replyIntent: reply?.replyIntent,
            questionType: reply?.questionType,
            factStatus: reply?.factStatus,
            guardrailAction: reply?.guardrailAction,
            guardrailReason: reply?.guardrailReason,
            knowledgeMissReason: reply?.knowledgeMissReason,
            autoSendBlockedReason: reply?.autoSendBlockedReason,
            matchedSlotIndex: reply?.matchedSlotIndex,
            matchedTitle: reply?.matchedTitle,
            matchedFields: reply?.matchedFields,
          }
        }),
        ...replies
          .filter(reply => !comments.some(comment => comment.msg_id === reply.commentId))
          .map(reply => ({
            sessionId,
            sessionStartedAt,
            sessionEndedAt,
            commentId: reply.commentId,
            commentTime: '',
            nickname: reply.replyFor,
            commentContent: '',
            replyTime: reply.time,
            replyContent: reply.replyContent,
            isSent: reply.isSent,
            source: reply.source as AutoReplyExportRow['source'],
            replyIntent: reply.replyIntent,
            questionType: reply.questionType,
            factStatus: reply.factStatus,
            guardrailAction: reply.guardrailAction,
            guardrailReason: reply.guardrailReason,
            knowledgeMissReason: reply.knowledgeMissReason,
            autoSendBlockedReason: reply.autoSendBlockedReason,
            matchedSlotIndex: reply.matchedSlotIndex,
            matchedTitle: reply.matchedTitle,
            matchedFields: reply.matchedFields,
          })),
      ]
    }

    const exportSessionId =
      selectedSessionKey === 'current'
        ? (currentSessionId ?? 'current-session')
        : selectedSessionKey === 'all'
          ? 'all-sessions'
          : activeSession?.key
    const exportSessionStartedAt =
      selectedSessionKey === 'current'
        ? (currentSessionStartedAt ?? undefined)
        : activeSession?.sessionStartedAt

    const rows = buildRowsFromSession({
      sessionId: exportSessionId,
      sessionStartedAt: exportSessionStartedAt,
      sessionEndedAt: activeSession?.sessionEndedAt,
      comments: displayedComments,
      replies: displayedReplies,
    }).sort((a, b) => {
      const aTime = new Date(a.commentTime || a.replyTime || 0).getTime()
      const bTime = new Date(b.commentTime || b.replyTime || 0).getTime()
      return aTime - bTime
    })

    return {
      accountName: accountName || '未知账号',
      exportedAt: Date.now(),
      stats: {
        totalComments: displayedComments.length,
        totalReplies: displayedReplies.length,
        sentReplies: rows.filter(row => row.isSent).length,
        rewrittenReplies: rows.filter(row => row.guardrailAction === 'rewrite').length,
      },
      knowledgeGovernance: knowledgeGovernanceSummary,
      rows,
    }
  }, [
    accountName,
    activeSession?.key,
    activeSession?.sessionEndedAt,
    activeSession?.sessionStartedAt,
    currentSessionId,
    currentSessionStartedAt,
    displayedComments,
    displayedReplies,
    knowledgeGovernanceSummary,
    selectedSessionKey,
  ])

  const canExport = exportData.rows.length > 0

  const runExport = useCallback(
    async (format: 'csv' | 'json') => {
      if (!canExport || isExporting) return
      setIsExporting(true)
      try {
        const result = await exportAutoReplyData(
          {
            ...exportData,
            exportedAt: Date.now(),
          },
          format,
        )

        if (result.success) {
          toast.success({
            title: '导出完成',
            description:
              format === 'csv'
                ? '自动回复当前分析场次已导出为 CSV，可点击“打开导出目录”查看。'
                : '自动回复当前分析场次已导出为 JSON，可点击“打开导出目录”查看。',
            dedupeKey: `auto-reply-export:${format}:${currentAccountId}`,
          })
        } else {
          toast.error({
            title: '导出失败',
            description: result.error || '导出失败，请稍后重试。',
            dedupeKey: `auto-reply-export-failed:${format}:${currentAccountId}`,
          })
        }
      } finally {
        setIsExporting(false)
      }
    },
    [canExport, currentAccountId, exportData, isExporting, toast],
  )

  const handleOpenFolder = useCallback(() => {
    void openAutoReplyExportFolder()
  }, [])

  const handleClearHistory = useCallback(() => {
    if (!hasAnyHistory) return
    if (!window.confirm('确认清空当前账号下的自动回复历史吗？此操作不可撤销。')) {
      return
    }
    clearHistory()
    toast.success({
      title: '历史已清空',
      description: '自动回复当前账号历史记录已清空。',
      dedupeKey: `auto-reply-clear-history:${currentAccountId}`,
    })
    setSelectedSessionKey('current')
  }, [clearHistory, currentAccountId, hasAnyHistory, toast])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClassName ?? 'h-8 gap-1 text-xs'}>
          <FileBarChart2 className="h-3.5 w-3.5" />
          运营分析
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(78vw,720px)] sm:max-w-none overflow-y-auto">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>自动回复运营分析</SheetTitle>
          <SheetDescription>查看场次统计、异常样本、知识回退和自动优化建议。</SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedSessionKey} onValueChange={setSelectedSessionKey}>
              <SelectTrigger size="sm" className="h-8 min-w-[14rem] text-xs">
                <SelectValue placeholder="选择场次" />
              </SelectTrigger>
              <SelectContent>
                {sessionOptions.map(option => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => void runExport('csv')}
              disabled={!canExport || isExporting}
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  disabled={!canExport || isExporting}
                >
                  <FileJson2 className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2">
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-2"
                    onClick={() => void runExport('json')}
                    disabled={!canExport || isExporting}
                  >
                    <FileJson2 className="h-4 w-4" />
                    导出 JSON
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-2"
                    onClick={handleOpenFolder}
                  >
                    <FolderOpen className="h-4 w-4" />
                    打开导出目录
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-2 text-destructive hover:text-destructive"
                    onClick={handleClearHistory}
                    disabled={!hasAnyHistory}
                  >
                    <Trash2 className="h-4 w-4" />
                    清空历史
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </SheetHeader>

        <div className="p-4 space-y-3">
          <SectionCollapsible
            title="总览统计"
            description="查看当前场次的基础命中和异常概览。"
            open={overviewOpen}
            onOpenChange={setOverviewOpen}
          >
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <MetricCard label="总回复数" value={String(knowledgeStats.total)} />
              <MetricCard label="知识库命中" value={String(knowledgeStats.kbHits)} />
              <MetricCard label="命中率" value={`${knowledgeStats.hitRate}%`} />
              <MetricCard
                label="FAQ 命中率"
                value={`${knowledgeStats.faqHits}/${knowledgeStats.kbHits || 0} (${knowledgeStats.faqHitRate}%)`}
              />
              <MetricCard
                label="高频商品号"
                value={knowledgeStats.topSlot ? `${knowledgeStats.topSlot}号` : '暂无'}
              />
              <MetricCard label="拦截重写数" value={String(knowledgeStats.rewrittenCount)} />
              <MetricCard
                label="常见回退原因"
                value={
                  knowledgeStats.topMissReason
                    ? missReasonLabelMap[knowledgeStats.topMissReason]
                    : '暂无'
                }
              />
              <MetricCard label="异常样本数" value={String(anomalyInsights.anomalyCount)} />
              <MetricCard label="缺少事实" value={String(anomalyInsights.missingFactCount)} />
              <MetricCard label="知识回退" value={String(anomalyInsights.knowledgeFallbackCount)} />
              <MetricCard
                label="自动发送拦截"
                value={String(anomalyInsights.autoSendBlockedCount)}
              />
              <MetricCard label="待处理样本" value={String(knowledgeLoopInsights.pendingCount)} />
              <MetricCard label="已采纳样本" value={String(knowledgeLoopInsights.adoptedCount)} />
              <MetricCard label="已忽略样本" value={String(knowledgeLoopInsights.dismissedCount)} />
              <MetricCard
                label="采纳后已稳定商品"
                value={String(knowledgeLoopInsights.stabilizedGoodsCount)}
              />
              <MetricCard
                label="高频异常意图"
                value={
                  topAnomalyIntentKey
                    ? (replyIntentLabelMap[topAnomalyIntentKey] ??
                      anomalyInsights.topReplyIntents[0]?.[0] ??
                      '暂无')
                    : '暂无'
                }
              />
            </div>
          </SectionCollapsible>

          <SectionCollapsible
            title="异常样本"
            description="点击样本后会自动定位到对应回复和评论，并关闭面板。"
            open={anomalyOpen}
            onOpenChange={setAnomalyOpen}
          >
            <div className="grid gap-2 xl:grid-cols-3">
              <InsightBlock title="高频拦截原因">
                {anomalyInsights.topGuardrailReasons.length > 0 ? (
                  anomalyInsights.topGuardrailReasons.map(([reason, count]) => (
                    <Pill
                      key={reason}
                      label={`${guardrailReasonLabelMap[reason] ?? reason} · ${count}`}
                    />
                  ))
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>

              <InsightBlock title="高频知识回退">
                {anomalyInsights.topKnowledgeMissReasons.length > 0 ? (
                  anomalyInsights.topKnowledgeMissReasons.map(([reason, count]) => (
                    <Pill
                      key={reason}
                      label={`${missReasonLabelMap[reason as keyof typeof missReasonLabelMap] ?? reason} · ${count}`}
                    />
                  ))
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>

              <InsightBlock title="自动发送拦截">
                {anomalyInsights.topAutoSendBlockedReasons.length > 0 ? (
                  anomalyInsights.topAutoSendBlockedReasons.map(([reason, count]) => (
                    <Pill
                      key={reason}
                      label={`${
                        autoSendBlockedReasonLabelMap[
                          reason as keyof typeof autoSendBlockedReasonLabelMap
                        ] ?? reason
                      } · ${count}`}
                    />
                  ))
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>

              <InsightBlock title="异常样本">
                {anomalyInsights.anomalySamples.length > 0 ? (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        共 {anomalyInsights.anomalySamples.length} 条
                      </span>
                      {anomalyInsights.anomalySamples.length > 5 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setShowAllAnomalySamples(prev => !prev)}
                        >
                          {showAllAnomalySamples ? '收起' : '展开更多'}
                        </Button>
                      ) : null}
                    </div>
                    <ScrollArea
                      className={`${showAllAnomalySamples ? 'max-h-96' : 'max-h-72'} w-full`}
                    >
                      <div className="space-y-2 pr-2">
                        {displayedAnomalySamples.map(sample => (
                          <SampleCard
                            key={sample.commentId}
                            title={sample.commentContent || sample.replyContent}
                            subtitle={
                              sample.guardrailReason
                                ? (guardrailReasonLabelMap[sample.guardrailReason] ??
                                  sample.guardrailReason)
                                : sample.autoSendBlockedReason
                                  ? (autoSendBlockedReasonLabelMap[
                                      sample.autoSendBlockedReason as keyof typeof autoSendBlockedReasonLabelMap
                                    ] ?? sample.autoSendBlockedReason)
                                  : sample.knowledgeMissReason
                                    ? (missReasonLabelMap[
                                        sample.knowledgeMissReason as keyof typeof missReasonLabelMap
                                      ] ?? sample.knowledgeMissReason)
                                    : (replyIntentLabelMap[
                                        sample.replyIntent as keyof typeof replyIntentLabelMap
                                      ] ?? sample.replyIntent)
                            }
                            onClick={() => {
                              onLocateComment(sample.commentId)
                              setOpen(false)
                            }}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>
            </div>
          </SectionCollapsible>

          {anomalyInsights.suggestions.length > 0 && (
            <SectionCollapsible
              title="自动优化建议"
              description="根据异常样本自动给出下一步补知识卡或补字段建议。"
              open={suggestionsOpen}
              onOpenChange={setSuggestionsOpen}
            >
              <div className="grid gap-2">
                {anomalyInsights.suggestions.map(suggestion => (
                  <div
                    key={`${suggestion.title}-${suggestion.description}`}
                    className="rounded-md bg-background/80 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {suggestion.title}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {suggestion.description}
                        </div>
                      </div>
                      {suggestion.slotIndex ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 text-xs"
                          onClick={() =>
                            navigateToKnowledgeWorkbench({
                              slotIndex: suggestion.slotIndex,
                              title: suggestion.title,
                              description: suggestion.description,
                              sampleQuestion: suggestion.sampleQuestion,
                              sampleAnswer:
                                suggestion.kind === 'alias-faq'
                                  ? '把这条人工确认过的回复沉淀为 FAQ 标准答案'
                                  : undefined,
                              assistFilter: suggestionFilterMap[suggestion.kind],
                            })
                          }
                        >
                          去补充
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCollapsible>
          )}

          <SectionCollapsible
            title="知识闭环"
            description="查看待处理样本规模，以及最近已采纳/已忽略的处理记录。"
            open={knowledgeLoopOpen}
            onOpenChange={setKnowledgeLoopOpen}
          >
            <div className="grid gap-2 xl:grid-cols-2">
              <InsightBlock title="状态快捷跳转">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    navigateToKnowledgeWorkbench({
                      title: '查看仍有缺口的商品',
                      description: '优先处理还有待处理样本的商品。',
                      assistFilter: 'knowledge-gap',
                    })
                  }
                >
                  仍有缺口
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    navigateToKnowledgeWorkbench({
                      title: '查看待复查的商品',
                      description: '这些商品在采纳 FAQ 后又新增了待处理样本，建议复查覆盖情况。',
                      assistFilter: 'knowledge-review',
                    })
                  }
                >
                  待复查
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    navigateToKnowledgeWorkbench({
                      title: '查看效果好的商品',
                      description: '这些商品已采纳 FAQ，且最近没有新增待处理样本。',
                      assistFilter: 'knowledge-good',
                    })
                  }
                >
                  效果好
                </Button>
              </InsightBlock>

              <InsightBlock title="待处理商品">
                {knowledgeLoopInsights.topPendingGoods.length > 0 ? (
                  knowledgeLoopInsights.topPendingGoods.map(([goodsId, count]) => (
                    <Button
                      key={goodsId}
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() =>
                        navigateToKnowledgeWorkbench({
                          slotIndex: goodsId,
                          title: `处理 ${goodsId} 号商品待处理样本`,
                          description: `当前有 ${count} 条待处理命中样本，建议补 FAQ 或别名后再继续观察。`,
                          assistFilter: getKnowledgeHealthAssistFilter(goodsId),
                        })
                      }
                    >
                      {goodsId}号 · {count}条
                    </Button>
                  ))
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>

              <InsightBlock title="采纳后仍新增样本">
                {knowledgeLoopInsights.topPostAdoptionPendingGoods.length > 0 ? (
                  knowledgeLoopInsights.topPostAdoptionPendingGoods.map(([goodsId, count]) => (
                    <Button
                      key={goodsId}
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() =>
                        navigateToKnowledgeWorkbench({
                          slotIndex: goodsId,
                          title: `复查 ${goodsId} 号商品 FAQ 效果`,
                          description: `该商品在采纳 FAQ 后又新增了 ${count} 条待处理样本，建议补充更多 FAQ 或别名。`,
                          assistFilter: 'knowledge-review',
                        })
                      }
                    >
                      {goodsId}号 · 新增 {count}条
                    </Button>
                  ))
                ) : (
                  <EmptyText text="暂无采纳后新增样本的商品" />
                )}
              </InsightBlock>

              <InsightBlock title="最近处理记录">
                {knowledgeLoopInsights.recentHandledSamples.length > 0 ? (
                  <div className="w-full space-y-2">
                    {knowledgeLoopInsights.recentHandledSamples.map(sample => (
                      <SampleCard
                        key={sample.key}
                        title={sample.question}
                        subtitle={`${sample.goodsId}号 · ${sample.decision === 'adopted' ? '已采纳' : '已忽略'}`}
                        onClick={() =>
                          navigateToKnowledgeWorkbench({
                            slotIndex: sample.goodsId,
                            title: `查看 ${sample.goodsId} 号商品知识卡`,
                            description: '继续完善最近处理过的 FAQ 样本。',
                            sampleQuestion: sample.question,
                            sampleAnswer: sample.answer,
                            assistFilter:
                              sample.decision === 'adopted' ? 'knowledge-good' : 'knowledge-review',
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyText />
                )}
              </InsightBlock>
            </div>
          </SectionCollapsible>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/60 px-3 py-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function InsightBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-background/60 px-3 py-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Pill({ label }: { label: string }) {
  return <span className="rounded-full bg-background px-2 py-1 text-[11px]">{label}</span>
}

function SampleCard({
  title,
  subtitle,
  onClick,
}: {
  title: string
  subtitle?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md bg-background px-3 py-2 text-left transition-colors hover:bg-accent/40"
    >
      <div className="truncate text-[11px] text-foreground">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle || '暂无'}</div>
    </button>
  )
}

function EmptyText({ text = '暂无' }: { text?: string }) {
  return <span className="text-[11px] text-muted-foreground">{text}</span>
}

function SectionCollapsible({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-4 space-y-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}
