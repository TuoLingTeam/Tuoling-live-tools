import type { AIProvider } from '@/hooks/useAIChat'
import { getEffectiveAICredentials } from '@/hooks/useAITrial'
import type { GoodsItemConfig } from '@/hooks/useAutoPopUp'
import {
  buildFallbackFaqFromKnowledgeDraft,
  buildKnowledgeDraftPrompt,
  parseKnowledgeDraftResponse,
} from '@/lib/productKnowledge'
import type { ToastApi } from '@/pages/SubAccount/subAccountControllerActionTypes'
import {
  KNOWLEDGE_TEMPLATE,
  parseKnowledgeImportText,
  serializeKnowledgeItems,
} from './goodsKnowledge'
import {
  goodsToText,
  mergeGoodsByIds,
  mergeGoodsByScanResult,
  parseGoods,
} from './goodsListCardUtils'

type PersistManualGoods = (nextGoods: GoodsItemConfig[]) => void

export function saveGoodsFromText(params: {
  inputValue: string
  goods: GoodsItemConfig[]
  persistManualGoods: PersistManualGoods
  setIsEditing: (value: boolean) => void
  toast: ToastApi
}) {
  const { inputValue, goods, persistManualGoods, setIsEditing, toast } = params
  const newItems = parseGoods(inputValue)
  if (newItems.length === 0) {
    toast.error('请输入有效的商品序号')
    return
  }

  const mergedItems = newItems.map(newItem => {
    const existing = goods.find(item => item.id === newItem.id)
    return existing ? { ...existing } : newItem
  })
  persistManualGoods(mergedItems)
  setIsEditing(false)
  toast.success(`已保存 ${newItems.length} 个商品`)
}

export function clearGoodsList(params: {
  persistManualGoods: PersistManualGoods
  setInputValue: (value: string) => void
  toast: ToastApi
}) {
  params.persistManualGoods([])
  params.setInputValue('')
  params.toast.success('已清空商品列表')
}

export function addSampleGoods(params: {
  goods: GoodsItemConfig[]
  persistManualGoods: PersistManualGoods
  toast: ToastApi
}) {
  const samples = [1, 2, 3, 4, 5].map(id => ({ id }))
  const newItems = [...params.goods]
  for (const sample of samples) {
    if (!newItems.find(item => item.id === sample.id)) {
      newItems.push(sample)
    }
  }
  params.persistManualGoods(newItems)
  params.toast.success('已添加示例商品')
}

export function importGoodsKnowledge(params: {
  importText: string
  goods: GoodsItemConfig[]
  persistManualGoods: PersistManualGoods
  setImportText: (value: string) => void
  toast: ToastApi
}) {
  const importedItems = parseKnowledgeImportText(params.importText)
  if (importedItems.length === 0) {
    params.toast.error('没有识别到有效的商品知识模板')
    return
  }

  const mergedItems = importedItems.map(importedItem => {
    const existing = params.goods.find(item => item.id === importedItem.id)
    return existing ? { ...existing, ...importedItem } : importedItem
  })

  const untouchedItems = params.goods.filter(
    existing => !mergedItems.some(imported => imported.id === existing.id),
  )

  params.persistManualGoods([...mergedItems, ...untouchedItems].sort((a, b) => a.id - b.id))
  params.setImportText('')
  params.toast.success(`已导入 ${importedItems.length} 个商品知识卡`)
}

export async function scanGoodsKnowledgeDraft(params: {
  goodsId: number
  currentAccountId: string | null
  connectionStatus: string
  provider: AIProvider
  model: string
  apiKeys: Record<string, string>
  customBaseURL: string
  ensureTrialSession: (feature: 'chat' | 'auto_reply' | 'knowledge_draft') => Promise<unknown>
  reportTrialUse: (payload: {
    feature: 'chat' | 'auto_reply' | 'knowledge_draft'
    model: string
  }) => Promise<unknown>
  toast: ToastApi
}) {
  const {
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
  } = params

  if (!currentAccountId) {
    toast.error('请先选择账号')
    return null
  }

  if (connectionStatus !== 'connected') {
    toast.error('请先连接直播中控台，再扫描商品详情')
    return null
  }

  const scanResult = await window.autoPopUpAPI.scanGoodsKnowledge(currentAccountId, goodsId)

  if (!scanResult.success || !scanResult.data) {
    toast.error(scanResult.error || '扫描商品详情失败')
    return null
  }

  if (!apiKeys[provider]) {
    await ensureTrialSession('knowledge_draft')
  }

  const credentials = getEffectiveAICredentials({
    feature: 'knowledge_draft',
    userProvider: provider,
    userModel: model,
    userApiKey: apiKeys[provider],
    userCustomBaseURL: customBaseURL,
  })

  if (!credentials) {
    toast.success('已回填基础信息，可继续手动补充知识内容')
    return {
      title: scanResult.data.title,
      priceText: scanResult.data.priceText,
    }
  }

  const rawDraft = await window.aiChatAPI.normalChat({
    messages: [
      {
        role: 'system',
        content: buildKnowledgeDraftPrompt(scanResult.data),
      },
    ],
    provider: credentials.provider,
    model: credentials.model,
    apiKey: credentials.apiKey,
    customBaseURL: credentials.customBaseURL,
  })

  if (typeof rawDraft !== 'string') {
    toast.error('知识草稿生成失败')
    return null
  }

  const parsed = parseKnowledgeDraftResponse(rawDraft)
  if (!parsed) {
    toast.error('知识草稿解析失败')
    return null
  }

  toast.success('已生成商品知识候选内容，请确认后保存')
  if (credentials.credentialMode === 'trial') {
    await reportTrialUse({ feature: 'knowledge_draft', model: credentials.model })
  }
  const draftWithFallbackFaq = {
    ...parsed,
    faq: parsed.faq?.length ? parsed.faq : buildFallbackFaqFromKnowledgeDraft(parsed),
  }
  return {
    ...draftWithFallbackFaq,
    title: draftWithFallbackFaq.title || scanResult.data.title,
    priceText: draftWithFallbackFaq.priceText || scanResult.data.priceText,
  }
}

export async function copyKnowledgeTemplate(toast: ToastApi) {
  try {
    await navigator.clipboard.writeText(KNOWLEDGE_TEMPLATE)
    toast.success('知识卡模板已复制到剪贴板')
  } catch {
    toast.error('复制模板失败，请重试')
  }
}

export function exportGoodsKnowledge(goods: GoodsItemConfig[], toast: ToastApi) {
  if (goods.length === 0) {
    toast.error('当前没有可导出的商品知识卡')
    return
  }

  const text = serializeKnowledgeItems(goods)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `商品知识卡-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
  toast.success('商品知识卡已导出')
}

export async function autoFillGoods(params: {
  source?: 'manual' | 'init'
  currentAccountId: string | null
  connectionStatus: string
  goods: GoodsItemConfig[]
  setGoods: (items: GoodsItemConfig[]) => void
  setGoodsAutoFillState: (state: {
    goodsAutoFillAttempted?: boolean
    goodsAutoFillLocked?: boolean
  }) => void
  setInputValue: (value: string) => void
  setIsEditing: (value: boolean) => void
  setIsAutoFilling: (value: boolean) => void
  autoFillRequestRef: React.MutableRefObject<boolean>
  toast: ToastApi
}) {
  const {
    source = 'manual',
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
  } = params

  if (!currentAccountId) {
    if (source === 'manual') {
      toast.error('请先选择账号')
    }
    return
  }
  if (connectionStatus !== 'connected') {
    if (source === 'manual') {
      toast.error('请先连接直播中控台，再自动读取商品序号')
    }
    return
  }

  setIsAutoFilling(true)
  try {
    const result = await window.autoPopUpAPI.fetchGoodsIds(currentAccountId)
    if (!result.success || !result.goodsIds || result.goodsIds.length === 0) {
      if (source === 'manual') {
        toast.error(result.error || '未读取到商品序号')
      }
      return
    }

    const mergedGoods =
      result.goods && result.goods.length > 0
        ? mergeGoodsByScanResult(goods, result.goods)
        : mergeGoodsByIds(goods, result.goodsIds)
    setGoods(mergedGoods)
    setGoodsAutoFillState({
      goodsAutoFillAttempted: true,
    })
    setInputValue(goodsToText(mergedGoods))
    setIsEditing(false)
    if (source === 'manual') {
      toast.success(`已自动填充 ${result.goodsIds.length} 个商品序号`)
    }
  } catch (error) {
    if (source === 'manual') {
      toast.error(error instanceof Error ? error.message : '自动填充失败')
    }
  } finally {
    setIsAutoFilling(false)
    autoFillRequestRef.current = false
  }
}

export function updateGoodsItem(
  goods: GoodsItemConfig[],
  updatedItem: GoodsItemConfig,
  persistManualGoods: PersistManualGoods,
  toast: ToastApi,
) {
  const newGoods = goods.map(item => (item.id === updatedItem.id ? updatedItem : item))
  persistManualGoods(newGoods)
  toast.success(`商品 #${updatedItem.id} 设置已更新`)
}
