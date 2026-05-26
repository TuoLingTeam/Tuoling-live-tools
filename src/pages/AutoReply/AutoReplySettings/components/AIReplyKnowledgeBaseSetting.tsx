import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  DatabaseZap,
  FileInput,
  Loader2,
  PackageOpen,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAutoReplyStore } from '@/hooks/autoReplyStore'
import { useAccounts } from '@/hooks/useAccounts'
import { useAIChatStore } from '@/hooks/useAIChat'
import { useAITrialStore } from '@/hooks/useAITrial'
import {
  type GoodsItemConfig,
  type KnowledgeSampleDecision,
  useAutoPopUpActions,
  useCurrentAutoPopUp,
} from '@/hooks/useAutoPopUp'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useConnectionStatus } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { decideAutoReply } from '@/lib/autoReplyDecision'
import { GoodsItemEditDialog } from '@/pages/AutoPopUp/components/GoodsItemEditDialog'
import { GoodsKnowledgeImportPanel } from '@/pages/AutoPopUp/components/GoodsKnowledgeImportPanel'
import {
  autoFillGoods,
  copyKnowledgeTemplate,
  exportGoodsKnowledge,
  importGoodsKnowledge,
  scanGoodsKnowledgeDraft,
} from '@/pages/AutoPopUp/components/goodsListCardActions'

const knowledgeFilters = [
  { value: 'all', label: '全部' },
  { value: 'missing-faq', label: '缺 FAQ' },
  { value: 'missing-facts', label: '缺价格/库存' },
  { value: 'gap', label: '仍有缺口' },
  { value: 'review', label: '待复查' },
  { value: 'good', label: '效果好' },
] as const

type KnowledgeFilter = (typeof knowledgeFilters)[number]['value']

const fieldLabelMap: Record<string, string> = {
  aliases: '别名',
  faq: 'FAQ',
  goodsList: '商品清单',
  highlights: '卖点',
  priceText: '价格',
  promoText: '优惠',
  slotIndex: '商品号',
  stockText: '库存',
  title: '标题',
}

const missReasonLabelMap = {
  'keyword-not-found': '未匹配商品关键词',
  'no-items': '当前没有商品知识卡',
  'not-product-query': '普通闲聊',
  'reference-expired': '商品指代已过期',
  'slot-not-found': '链接号未配置',
} as const

function sortGoods(goods: GoodsItemConfig[]) {
  return [...goods].sort((a, b) => a.id - b.id)
}

function getNextGoodsId(goods: GoodsItemConfig[]) {
  return Math.max(0, ...goods.map(item => item.id)) + 1
}

function getItemTitle(item: GoodsItemConfig) {
  return item.shortTitle || item.title || `${item.id}号商品`
}

function itemMatchesSearch(item: GoodsItemConfig, keyword: string) {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return true

  const searchable = [
    String(item.id),
    item.title,
    item.shortTitle,
    item.priceText,
    item.promoText,
    item.stockText,
    ...(item.aliases ?? []),
    ...(item.highlights ?? []),
    ...(item.faq ?? []).flatMap(faq => [faq.q, faq.a]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return searchable.includes(normalized)
}

function getKnowledgeHealth(params: {
  item: GoodsItemConfig
  pendingCount: number
  adoptedCount: number
}) {
  const { item, pendingCount, adoptedCount } = params

  if (pendingCount > 0 && adoptedCount > 0) {
    return {
      label: '待复查',
      variant: 'warning' as const,
      description: `新增 ${pendingCount} 条待处理样本`,
    }
  }

  if (pendingCount > 0) {
    return {
      label: '仍有缺口',
      variant: 'destructive' as const,
      description: `${pendingCount} 条待处理样本`,
    }
  }

  if (adoptedCount > 0) {
    return {
      label: '效果好',
      variant: 'success' as const,
      description: '已采纳 FAQ',
    }
  }

  if (!item.title || !item.faq?.length) {
    return {
      label: '待完善',
      variant: 'neutral' as const,
      description: '基础字段不足',
    }
  }

  return {
    label: '可用',
    variant: 'info' as const,
    description: '基础知识已填写',
  }
}

export function AIReplyKnowledgeBaseSetting() {
  const searchId = useId()
  const testId = useId()
  const { config } = useAutoReplyConfig()
  const goods = useCurrentAutoPopUp(context => context.config.goods) ?? []
  const defaultInterval = useCurrentAutoPopUp(context => context.config.scheduler.interval)
  const knowledgeSampleDecisions = useCurrentAutoPopUp(
    context => context.knowledgeSampleDecisions ?? {},
  )
  const { setGoods, setGoodsAutoFillState, setKnowledgeSampleDecision } = useAutoPopUpActions()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const connectionStatus = useConnectionStatus()
  const autoReplyContext = useAutoReplyStore(state => state.contexts[currentAccountId])
  const provider = useAIChatStore(state => state.config.provider)
  const model = useAIChatStore(state => state.config.model)
  const apiKeys = useAIChatStore(state => state.apiKeys)
  const customBaseURL = useAIChatStore(state => state.customBaseURL)
  const ensureTrialSession = useAITrialStore(state => state.ensureSession)
  const reportTrialUse = useAITrialStore(state => state.reportUse)
  const { toast } = useToast()
  const [filter, setFilter] = useState<KnowledgeFilter>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [testComment, setTestComment] = useState('')
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [isAutoFilling, setIsAutoFilling] = useState(false)
  const [editingItem, setEditingItem] = useState<GoodsItemConfig | null>(null)
  const autoFillRequestRef = useRef(false)

  const recentQuestionSamples = useMemo(() => {
    const commentById = new Map(
      (autoReplyContext?.comments ?? [])
        .map(comment => {
          const content =
            'content' in comment && typeof comment.content === 'string' ? comment.content : ''
          return [comment.msg_id, content] as const
        })
        .filter(([, content]) => content.trim().length > 0),
    )

    return (autoReplyContext?.replies ?? [])
      .filter(reply => reply.matchedSlotIndex && commentById.has(reply.commentId))
      .map(reply => {
        const sampleKey = `${reply.matchedSlotIndex}:${reply.commentId}`
        const decision = knowledgeSampleDecisions[sampleKey] as KnowledgeSampleDecision | undefined

        return {
          key: sampleKey,
          goodsId: reply.matchedSlotIndex as number,
          commentId: reply.commentId,
          question: commentById.get(reply.commentId)?.trim() ?? '',
          answer: reply.replyContent.trim(),
          isSent: reply.isSent,
          source: reply.source,
          time: reply.time,
          decisionStatus: decision?.status,
          decidedAt: decision?.decidedAt,
        }
      })
      .filter(sample => sample.question && sample.answer)
      .slice(0, 48)
  }, [autoReplyContext?.comments, autoReplyContext?.replies, knowledgeSampleDecisions])

  const sampleStatsByGoodsId = useMemo(() => {
    const stats = new Map<number, { pending: number; adopted: number }>()
    for (const sample of recentQuestionSamples) {
      const current = stats.get(sample.goodsId) ?? { pending: 0, adopted: 0 }
      if (!sample.decisionStatus) {
        current.pending += 1
      }
      if (sample.decisionStatus === 'adopted') {
        current.adopted += 1
      }
      stats.set(sample.goodsId, current)
    }
    return stats
  }, [recentQuestionSamples])

  const filteredGoods = useMemo(() => {
    return goods.filter(item => {
      const stats = sampleStatsByGoodsId.get(item.id) ?? { pending: 0, adopted: 0 }
      const matchesFilter =
        filter === 'all' ||
        (filter === 'missing-faq' && !item.faq?.length) ||
        (filter === 'missing-facts' && (!item.priceText || !item.stockText)) ||
        (filter === 'gap' && stats.pending > 0 && stats.adopted === 0) ||
        (filter === 'review' && stats.pending > 0 && stats.adopted > 0) ||
        (filter === 'good' && stats.pending === 0 && stats.adopted > 0)

      return matchesFilter && itemMatchesSearch(item, searchKeyword)
    })
  }, [filter, goods, sampleStatsByGoodsId, searchKeyword])

  const knowledgeStats = useMemo(() => {
    const faqCount = goods.reduce((count, item) => count + (item.faq?.length ?? 0), 0)
    const readyCount = goods.filter(item => Boolean(item.title && item.faq?.length)).length
    const pendingSampleCount = [...sampleStatsByGoodsId.values()].reduce(
      (count, stat) => count + stat.pending,
      0,
    )
    const missingFactCount = goods.filter(item => !item.priceText || !item.stockText).length

    return {
      faqCount,
      missingFactCount,
      pendingSampleCount,
      readyCount,
      total: goods.length,
    }
  }, [goods, sampleStatsByGoodsId])

  const testDecision = useMemo(() => {
    const comment = testComment.trim()
    if (!comment) return null

    return decideAutoReply({
      comment,
      items: goods,
    })
  }, [goods, testComment])

  const persistManualGoods = (nextGoods: GoodsItemConfig[]) => {
    setGoods(sortGoods(nextGoods))
    setGoodsAutoFillState({
      goodsAutoFillAttempted: true,
      goodsAutoFillLocked: true,
    })
  }

  const handleSaveItem = (updatedItem: GoodsItemConfig) => {
    const nextGoods = goods.some(item => item.id === updatedItem.id)
      ? goods.map(item => (item.id === updatedItem.id ? updatedItem : item))
      : [...goods, updatedItem]
    persistManualGoods(nextGoods)
    toast.success(`商品 #${updatedItem.id} 知识卡已保存`)
  }

  const handleDeleteItem = (goodsId: number) => {
    persistManualGoods(goods.filter(item => item.id !== goodsId))
    if (editingItem?.id === goodsId) {
      setEditingItem(null)
    }
    toast.success(`商品 #${goodsId} 已移出知识库`)
  }

  const handleAddItem = () => {
    setEditingItem({ id: getNextGoodsId(goods) })
  }

  const handleImportKnowledge = () => {
    importGoodsKnowledge({
      goods,
      importText,
      persistManualGoods,
      setImportText,
      toast,
    })
  }

  const handleAutoFill = async () => {
    await autoFillGoods({
      source: 'manual',
      currentAccountId,
      connectionStatus,
      goods,
      setGoods,
      setGoodsAutoFillState,
      setInputValue: () => {},
      setIsEditing: () => {},
      setIsAutoFilling,
      autoFillRequestRef,
      toast,
    })
  }

  const handleScanKnowledge = async (goodsId: number) => {
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
  }

  const editingGoods = editingItem
    ? goods.some(item => item.id === editingItem.id)
      ? goods
      : sortGoods([...goods, editingItem])
    : goods

  return (
    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-medium">AI回复知识库</h4>
            <Badge
              variant={config.comment.aiReply.enable ? 'success' : 'neutral'}
              className="rounded"
            >
              {config.comment.aiReply.enable ? '运行中可用' : '启用AI后可用'}
            </Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            商品事实与自动弹窗共用同一份商品知识卡。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={handleAutoFill}
            disabled={isAutoFilling}
          >
            {isAutoFilling ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            自动读取商品
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={handleAddItem}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新增知识卡
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KnowledgeMetric label="商品卡" value={knowledgeStats.total} />
        <KnowledgeMetric label="可用卡" value={knowledgeStats.readyCount} />
        <KnowledgeMetric label="FAQ" value={knowledgeStats.faqCount} />
        <KnowledgeMetric label="缺事实" value={knowledgeStats.missingFactCount} />
        <KnowledgeMetric label="待处理样本" value={knowledgeStats.pendingSampleCount} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {knowledgeFilters.map(item => (
            <Button
              key={item.value}
              type="button"
              variant={filter === item.value ? 'default' : 'outline'}
              size="sm"
              className="h-8"
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="relative min-w-0 lg:w-72">
          <Label htmlFor={searchId} className="sr-only">
            搜索商品知识卡
          </Label>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            id={searchId}
            value={searchKeyword}
            onChange={event => setSearchKeyword(event.target.value)}
            placeholder="搜索商品号、别名、FAQ"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        {filteredGoods.length > 0 ? (
          <div className="max-h-72 divide-y overflow-y-auto">
            {filteredGoods.map(item => {
              const sampleStats = sampleStatsByGoodsId.get(item.id) ?? { pending: 0, adopted: 0 }
              const health = getKnowledgeHealth({
                item,
                pendingCount: sampleStats.pending,
                adoptedCount: sampleStats.adopted,
              })

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 bg-background/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">#{item.id}</span>
                      <span className="max-w-56 truncate text-sm text-foreground">
                        {getItemTitle(item)}
                      </span>
                      <Badge variant={health.variant} className="rounded">
                        {health.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      {item.priceText ? <KnowledgePill text={item.priceText} /> : null}
                      {item.stockText ? <KnowledgePill text={item.stockText} /> : null}
                      {item.aliases?.length ? (
                        <KnowledgePill text={`别名 ${item.aliases.length}`} />
                      ) : null}
                      {item.faq?.length ? <KnowledgePill text={`FAQ ${item.faq.length}`} /> : null}
                      {sampleStats.pending > 0 ? (
                        <KnowledgePill tone="warning" text={`样本 ${sampleStats.pending}`} />
                      ) : null}
                      <span className="px-1.5 py-0.5">{health.description}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setEditingItem(item)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`删除${item.id}号商品知识卡`}
                      onClick={() => handleDeleteItem(item.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground">
            <PackageOpen className="h-6 w-6" />
            <span>{goods.length === 0 ? '暂无商品知识卡' : '没有符合筛选的知识卡'}</span>
            {goods.length === 0 ? (
              <Button type="button" size="sm" className="mt-1 h-8" onClick={handleAddItem}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                新增知识卡
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-md border bg-background/40 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
          <div className="space-y-2">
            <Label htmlFor={testId} className="text-sm">
              命中测试
            </Label>
            <Input
              id={testId}
              value={testComment}
              onChange={event => setTestComment(event.target.value)}
              placeholder="例如：3号多少钱"
              className="h-9"
            />
          </div>
          <div className="min-h-20 rounded-md bg-muted/30 px-3 py-2 text-xs">
            {testDecision ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {testDecision.mode === 'product-kb' ? (
                    <Badge variant="success" className="rounded">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      知识命中
                    </Badge>
                  ) : testDecision.mode === 'safe-fallback' ? (
                    <Badge variant="warning" className="rounded">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      安全兜底
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="rounded">
                      通用 AI
                    </Badge>
                  )}
                  {testDecision.productKnowledgeHit.slotIndex ? (
                    <KnowledgePill text={`${testDecision.productKnowledgeHit.slotIndex}号`} />
                  ) : null}
                  {testDecision.productKnowledgeHit.matchedFields?.map(field => (
                    <KnowledgePill key={field} text={fieldLabelMap[field] ?? field} />
                  ))}
                  {testDecision.productKnowledgeHit.missReason ? (
                    <KnowledgePill
                      tone="warning"
                      text={missReasonLabelMap[testDecision.productKnowledgeHit.missReason]}
                    />
                  ) : null}
                </div>
                <div className="leading-5 text-foreground/90">
                  {testDecision.replyContent || '将进入通用 AI 回复。'}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-16 items-center text-muted-foreground">
                输入评论后查看知识命中结果
              </div>
            )}
          </div>
        </div>
      </div>

      <Collapsible open={importOpen} onOpenChange={setImportOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8">
            <FileInput className="mr-1.5 h-3.5 w-3.5" />
            导入导出
            <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <GoodsKnowledgeImportPanel
            importText={importText}
            setImportText={setImportText}
            handleCopyTemplate={() => void copyKnowledgeTemplate(toast)}
            handleExportKnowledge={() => exportGoodsKnowledge(goods, toast)}
            handleImportKnowledge={handleImportKnowledge}
          />
        </CollapsibleContent>
      </Collapsible>

      {editingItem ? (
        <GoodsItemEditDialog
          item={editingItem}
          allGoods={editingGoods}
          defaultInterval={defaultInterval}
          dialogTitle="编辑AI回复知识卡"
          showIntervalSettings={false}
          recentQuestionSamples={recentQuestionSamples}
          onSampleDecisionChange={setKnowledgeSampleDecision}
          onSave={handleSaveItem}
          onClose={() => setEditingItem(null)}
          onScanKnowledge={handleScanKnowledge}
        />
      ) : null}
    </div>
  )
}

function KnowledgeMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  )
}

function KnowledgePill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warning' }) {
  return (
    <span
      className={
        tone === 'warning'
          ? 'rounded bg-warning/10 px-1.5 py-0.5 text-warning'
          : 'rounded bg-background/70 px-1.5 py-0.5 text-muted-foreground'
      }
    >
      {text}
    </span>
  )
}
