import { Clock, Loader2, Plus, ScanSearch, Trash2 } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { GoodsItemConfig } from '@/hooks/useAutoPopUp'
import {
  type FaqItem,
  getKnowledgeFieldDiffs,
  listToText,
  parseListText,
  toFaqItems,
} from './goodsKnowledge'

export interface GoodsItemEditDialogProps {
  item: GoodsItemConfig
  allGoods: GoodsItemConfig[]
  defaultInterval: [number, number]
  onSave: (item: GoodsItemConfig) => void
  onClose: () => void
  onScanKnowledge?: (id: number) => Promise<Partial<GoodsItemConfig> | null>
}

export const GoodsItemEditDialog: React.FC<GoodsItemEditDialogProps> = ({
  item,
  allGoods,
  defaultInterval,
  onSave,
  onClose,
  onScanKnowledge,
}) => {
  const [selectedId, setSelectedId] = useState(item.id)
  const selectedItem = allGoods.find(g => g.id === selectedId) || item

  const [useCustomInterval, setUseCustomInterval] = useState(!!selectedItem.interval)
  const [minInterval, setMinInterval] = useState(
    selectedItem.interval
      ? Math.round(selectedItem.interval[0] / 1000)
      : Math.round(defaultInterval[0] / 1000),
  )
  const [maxInterval, setMaxInterval] = useState(
    selectedItem.interval
      ? Math.round(selectedItem.interval[1] / 1000)
      : Math.round(defaultInterval[1] / 1000),
  )
  const [title, setTitle] = useState(selectedItem.title ?? '')
  const [shortTitle, setShortTitle] = useState(selectedItem.shortTitle ?? '')
  const [priceText, setPriceText] = useState(selectedItem.priceText ?? '')
  const [promoText, setPromoText] = useState(selectedItem.promoText ?? '')
  const [stockText, setStockText] = useState(selectedItem.stockText ?? '')
  const [aliasesText, setAliasesText] = useState(listToText(selectedItem.aliases))
  const [highlightsText, setHighlightsText] = useState(listToText(selectedItem.highlights))
  const [faqItems, setFaqItems] = useState<FaqItem[]>(toFaqItems(selectedItem.faq))
  const [isScanningKnowledge, setIsScanningKnowledge] = useState(false)
  const [draftKnowledge, setDraftKnowledge] = useState<Partial<GoodsItemConfig> | null>(null)

  const handleSelectChange = (id: number) => {
    setSelectedId(id)
    const newItem = allGoods.find(g => g.id === id)
    if (!newItem) return

    setUseCustomInterval(!!newItem.interval)
    setMinInterval(
      newItem.interval
        ? Math.round(newItem.interval[0] / 1000)
        : Math.round(defaultInterval[0] / 1000),
    )
    setMaxInterval(
      newItem.interval
        ? Math.round(newItem.interval[1] / 1000)
        : Math.round(defaultInterval[1] / 1000),
    )
    setTitle(newItem.title ?? '')
    setShortTitle(newItem.shortTitle ?? '')
    setPriceText(newItem.priceText ?? '')
    setPromoText(newItem.promoText ?? '')
    setStockText(newItem.stockText ?? '')
    setAliasesText(listToText(newItem.aliases))
    setHighlightsText(listToText(newItem.highlights))
    setFaqItems(toFaqItems(newItem.faq))
    setDraftKnowledge(null)
  }

  const handleSave = () => {
    onSave({
      id: selectedId,
      interval: useCustomInterval ? [minInterval * 1000, maxInterval * 1000] : undefined,
      title: title.trim() || undefined,
      shortTitle: shortTitle.trim() || undefined,
      priceText: priceText.trim() || undefined,
      promoText: promoText.trim() || undefined,
      stockText: stockText.trim() || undefined,
      aliases: parseListText(aliasesText),
      highlights: parseListText(highlightsText),
      faq: faqItems
        .map(item => ({ q: item.q.trim(), a: item.a.trim() }))
        .filter(item => item.q && item.a),
    })
    onClose()
  }

  const handleScanKnowledge = async () => {
    if (!onScanKnowledge) return
    setIsScanningKnowledge(true)
    try {
      const draft = await onScanKnowledge(selectedId)
      if (!draft) return
      setDraftKnowledge(draft)
    } finally {
      setIsScanningKnowledge(false)
    }
  }

  const currentEditingItem: GoodsItemConfig = {
    id: selectedId,
    interval: useCustomInterval ? [minInterval * 1000, maxInterval * 1000] : undefined,
    title,
    shortTitle,
    priceText,
    promoText,
    stockText,
    aliases: parseListText(aliasesText),
    highlights: parseListText(highlightsText),
    faq: faqItems
      .map(item => ({ q: item.q.trim(), a: item.a.trim() }))
      .filter(item => item.q && item.a),
  }

  const knowledgeDiffs = draftKnowledge
    ? getKnowledgeFieldDiffs(currentEditingItem, draftKnowledge)
    : []

  const handleApplyDraft = () => {
    if (!draftKnowledge) return
    setTitle(draftKnowledge.title ?? title)
    setShortTitle(draftKnowledge.shortTitle ?? shortTitle)
    setPriceText(draftKnowledge.priceText ?? priceText)
    setPromoText(draftKnowledge.promoText ?? promoText)
    setStockText(draftKnowledge.stockText ?? stockText)
    setAliasesText(draftKnowledge.aliases ? listToText(draftKnowledge.aliases) : aliasesText)
    setHighlightsText(
      draftKnowledge.highlights ? listToText(draftKnowledge.highlights) : highlightsText,
    )
    setFaqItems(draftKnowledge.faq ? toFaqItems(draftKnowledge.faq) : faqItems)
    setDraftKnowledge(null)
  }

  const handleDiscardDraft = () => {
    setDraftKnowledge(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[85vh] w-[44rem] overflow-y-auto rounded-lg border bg-background p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-bold">设置商品弹窗时间</h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">选择商品</Label>
            <div className="max-h-24 overflow-y-auto rounded-md border p-2">
              <div className="flex flex-wrap gap-2">
                {allGoods.map(g => (
                  <button
                    key={g.id}
                    onClick={() => handleSelectChange(g.id)}
                    className={`rounded px-2 py-1 text-sm font-medium transition-colors ${
                      selectedId === g.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    #{g.id}
                    {g.interval && <Clock className="ml-1 inline-block h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="custom-interval"
              checked={useCustomInterval}
              onCheckedChange={checked => setUseCustomInterval(checked === true)}
            />
            <Label htmlFor="custom-interval" className="cursor-pointer text-sm">
              使用自定义弹窗间隔
            </Label>
          </div>

          {useCustomInterval ? (
            <div className="space-y-2 pl-6">
              <Label className="text-xs text-muted-foreground">弹窗间隔（秒）</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={minInterval}
                  onChange={e => setMinInterval(Number(e.target.value))}
                  className="w-20 text-center"
                  min={1}
                />
                <span className="text-muted-foreground">-</span>
                <Input
                  type="number"
                  value={maxInterval}
                  onChange={e => setMaxInterval(Number(e.target.value))}
                  className="w-20 text-center"
                  min={1}
                />
                <span className="text-xs text-muted-foreground">秒</span>
              </div>
            </div>
          ) : (
            <p className="pl-6 text-xs text-muted-foreground">
              使用全局默认间隔：{Math.round(defaultInterval[0] / 1000)}-
              {Math.round(defaultInterval[1] / 1000)} 秒
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 border-t pt-2">
            <div className="space-y-2">
              <Label className="text-sm">商品标题</Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="例如：胶原修护面霜"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">商品简称</Label>
              <Input
                value={shortTitle}
                onChange={e => setShortTitle(e.target.value)}
                placeholder="例如：修护面霜"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">价格信息</Label>
              <Input
                value={priceText}
                onChange={e => setPriceText(e.target.value)}
                placeholder="例如：99元 / 到手89元"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">优惠信息</Label>
              <Input
                value={promoText}
                onChange={e => setPromoText(e.target.value)}
                placeholder="例如：拍2件减20"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="text-sm">库存/状态</Label>
              <Input
                value={stockText}
                onChange={e => setStockText(e.target.value)}
                placeholder="例如：现货充足 / 正在补货"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">别名关键词</Label>
              <Textarea
                value={aliasesText}
                onChange={e => setAliasesText(e.target.value)}
                placeholder={'每行一个，例如：\n面霜\n修护霜'}
                className="min-h-[7rem]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">卖点/亮点</Label>
              <Textarea
                value={highlightsText}
                onChange={e => setHighlightsText(e.target.value)}
                placeholder={'每行一个，例如：\n保湿\n修护屏障\n适合干皮'}
                className="min-h-[7rem]"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="text-sm">商品 FAQ</Label>
              <div className="space-y-2 rounded-lg border bg-muted/10 p-3">
                {faqItems.map((faqItem, index) => (
                  <div key={faqItem.id} className="grid gap-2 md:grid-cols-[1fr_1.6fr_auto]">
                    <Input
                      value={faqItem.q}
                      onChange={e =>
                        setFaqItems(items =>
                          items.map(item =>
                            item.id === faqItem.id ? { ...item, q: e.target.value } : item,
                          ),
                        )
                      }
                      placeholder={index === 0 ? '例如：适合谁' : '问题'}
                    />
                    <Input
                      value={faqItem.a}
                      onChange={e =>
                        setFaqItems(items =>
                          items.map(item =>
                            item.id === faqItem.id ? { ...item, a: e.target.value } : item,
                          ),
                        )
                      }
                      placeholder={index === 0 ? '例如：更适合干皮和混干皮' : '回答'}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setFaqItems(items =>
                          items.length > 1
                            ? items.filter(item => item.id !== faqItem.id)
                            : [{ id: crypto.randomUUID(), q: '', a: '' }],
                        )
                      }
                      aria-label="删除 FAQ"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-between gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    建议维护 2 到 4 条高频问答，例如价格、适合谁、怎么用。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFaqItems(items => [...items, { id: crypto.randomUUID(), q: '', a: '' }])
                    }
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    添加 FAQ
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {draftKnowledge && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">扫描候选内容</div>
                  <p className="text-xs text-muted-foreground">
                    先确认以下差异，再决定是否应用到当前商品知识卡。
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleDiscardDraft}>
                    丢弃候选
                  </Button>
                  <Button size="sm" onClick={handleApplyDraft}>
                    应用候选
                  </Button>
                </div>
              </div>
              {knowledgeDiffs.length > 0 ? (
                <div className="space-y-2">
                  {knowledgeDiffs.map(diff => (
                    <div key={diff.key} className="rounded-md border bg-background/60 p-3">
                      <div className="text-xs font-medium text-primary">{diff.label}</div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] text-muted-foreground">当前值</div>
                          <div className="whitespace-pre-wrap text-xs text-foreground/80">
                            {diff.currentValue || '空'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground">候选值</div>
                          <div className="whitespace-pre-wrap text-xs text-foreground">
                            {diff.draftValue}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  扫描成功，但没有发现需要更新的字段。
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleScanKnowledge()}>
            {isScanningKnowledge ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            )}
            扫描详情生成
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}
