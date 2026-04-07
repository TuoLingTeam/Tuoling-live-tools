import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useAIChatStore } from '@/hooks/useAIChat'
import { useAITrialStore } from '@/hooks/useAITrial'
import {
  type GoodsItemConfig,
  useAutoPopUpActions,
  useCurrentAutoPopUp,
} from '@/hooks/useAutoPopUp'
import { useConnectionStatus, useCurrentPlatform } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
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
  const { setGoods, setGoodsAutoFillState } = useAutoPopUpActions()
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
  const [inputValue, setInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editingItem, setEditingItem] = useState<GoodsItemConfig | null>(null)
  const [isAutoFilling, setIsAutoFilling] = useState(false)
  const [importText, setImportText] = useState('')
  const [dismissedAssist, setDismissedAssist] = useState(false)
  const [assistFilter, setAssistFilter] = useState<string>('all')
  const autoFillRequestRef = useRef(false)

  useEffect(() => {
    void currentAccountId
    setIsEditing(false)
    setInputValue('')
    setEditingItem(null)
    setDismissedAssist(false)
    setAssistFilter(initialAssistContext?.filter?.trim() || 'all')
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
  const initialAssistFilter = initialAssistContext?.filter?.trim()
  const showAssistWorkbench =
    !dismissedAssist && Boolean(assistTitle || assistDescription || assistQuestion)

  useEffect(() => {
    if (initialAssistFilter) {
      setAssistFilter(initialAssistFilter)
    }
  }, [initialAssistFilter])

  const filteredGoods = useMemo(() => {
    switch (assistFilter) {
      case 'faq-missing':
        return goods.filter(item => !item.faq?.length)
      case 'price-stock-missing':
        return goods.filter(item => !item.priceText || !item.stockText)
      case 'needs-basics':
        return goods.filter(item => !item.title || !item.priceText || !item.faq?.length)
      default:
        return goods
    }
  }, [assistFilter, goods])

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
