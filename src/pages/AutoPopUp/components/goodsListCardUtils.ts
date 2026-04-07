import type { GoodsItemConfig } from '@/hooks/useAutoPopUp'

export type GoodsListInitialAssistContext = {
  title?: string | null
  description?: string | null
  sampleQuestion?: string | null
  filter?: string | null
}

export function goodsToText(items: GoodsItemConfig[]) {
  return items.map(item => item.id).join(', ')
}

export function mergeGoodsByIds(goods: GoodsItemConfig[], ids: number[]) {
  return ids.map(id => goods.find(item => item.id === id) ?? { id })
}

export function mergeGoodsByScanResult(
  goods: GoodsItemConfig[],
  scannedGoods: Array<{ id: number; title?: string }>,
) {
  return scannedGoods.map(scannedItem => {
    const existing = goods.find(item => item.id === scannedItem.id)
    return existing
      ? {
          ...existing,
          title: existing.title || scannedItem.title || existing.title,
        }
      : {
          id: scannedItem.id,
          title: scannedItem.title,
        }
  })
}

export function parseGoods(text: string): GoodsItemConfig[] {
  const separators = /[,，\s\n]+/
  const parts = text.split(separators).filter(Boolean)
  const items: GoodsItemConfig[] = []
  const seen = new Set<number>()

  for (const part of parts) {
    const num = Number.parseInt(part.trim(), 10)
    if (!Number.isNaN(num) && num > 0 && !seen.has(num)) {
      items.push({ id: num })
      seen.add(num)
    }
  }

  return items
}
