import type { GoodsItemConfig } from '@/hooks/useAutoPopUp'

export type FaqItem = {
  id: string
  q: string
  a: string
}

export function listToText(values?: string[]) {
  return values?.join('\n') ?? ''
}

export function parseListText(text: string) {
  return text
    .split(/\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function faqToText(
  faq?: Array<{
    q: string
    a: string
  }>,
) {
  return faq?.map(item => `${item.q} => ${item.a}`).join('\n') ?? ''
}

export function parseFaqText(text: string) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [q, ...rest] = line.split(/\s*=>\s*|\s*→\s*|\s*:\s*|：/)
      return {
        q: q?.trim() ?? '',
        a: rest.join(' ').trim(),
      }
    })
    .filter(item => item.q && item.a)
}

export function parseKnowledgeImportText(text: string): GoodsItemConfig[] {
  return text
    .replace(/\t/g, '\n')
    .split(/\n{2,}|(?=\d+\s*号链接)/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n').map(line => line.trim())
      const id = Number.parseInt(lines[0]?.replace(/[^0-9]/g, '') ?? '', 10)
      if (!id || Number.isNaN(id)) return null

      const item: GoodsItemConfig = { id }

      const normalizedLines =
        lines.length === 1 && lines[0].includes('标题')
          ? lines[0]
              .replace(/^(\d+\s*号链接?)/, '$1\n')
              .split(/\s+(?=(?:标题|简称|价格|优惠|库存|卖点|别名|FAQ)\s*[:：=])/)
          : lines

      for (const line of normalizedLines.slice(1)) {
        const [rawKey, ...rest] = line.split(/[:：=]/)
        const key = rawKey?.trim()
        const value = rest.join(':').trim()
        if (!key || !value) continue

        switch (key) {
          case '标题':
            item.title = value
            break
          case '简称':
            item.shortTitle = value
            break
          case '价格':
            item.priceText = value
            break
          case '优惠':
            item.promoText = value
            break
          case '库存':
            item.stockText = value
            break
          case '卖点':
            item.highlights = parseListText(value)
            break
          case '别名':
            item.aliases = parseListText(value)
            break
          case 'FAQ':
            item.faq = parseFaqText(value.replace(/\s*\|\s*/g, '\n'))
            break
        }
      }

      return item
    })
    .filter((item): item is GoodsItemConfig => item !== null)
}

export function serializeKnowledgeItems(items: GoodsItemConfig[]) {
  return items
    .map(item =>
      [
        `${item.id}号链接`,
        item.title ? `标题: ${item.title}` : '',
        item.shortTitle ? `简称: ${item.shortTitle}` : '',
        item.priceText ? `价格: ${item.priceText}` : '',
        item.promoText ? `优惠: ${item.promoText}` : '',
        item.stockText ? `库存: ${item.stockText}` : '',
        item.highlights?.length ? `卖点: ${item.highlights.join(', ')}` : '',
        item.aliases?.length ? `别名: ${item.aliases.join(', ')}` : '',
        item.faq?.length ? `FAQ: ${item.faq.map(faq => `${faq.q} => ${faq.a}`).join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

export const KNOWLEDGE_TEMPLATE = [
  '3号链接',
  '标题: 胶原修护面霜',
  '简称: 修护面霜',
  '价格: 99元',
  '优惠: 拍2件减20',
  '库存: 现货充足',
  '卖点: 保湿, 修护屏障, 适合干皮',
  '别名: 面霜, 修护霜',
  'FAQ: 适合谁 => 更适合干皮和混干皮 | 怎么用 => 洁面后取适量涂抹',
  '',
  '4号链接',
  '标题: 舒缓精华',
  '简称: 修护精华',
  '价格: 129元',
  '优惠: 第二件半价',
  '卖点: 舒缓, 维稳, 敏感肌友好',
].join('\n')

export function getKnowledgeFieldDiffs(current: GoodsItemConfig, draft: Partial<GoodsItemConfig>) {
  const fields: Array<{
    key: string
    label: string
    currentValue: string
    draftValue: string
  }> = []

  const pushField = (key: string, label: string, currentValue?: string, draftValue?: string) => {
    const currentText = currentValue?.trim() ?? ''
    const draftText = draftValue?.trim() ?? ''
    if (!draftText || currentText === draftText) return
    fields.push({ key, label, currentValue: currentText, draftValue: draftText })
  }

  pushField('title', '商品标题', current.title, draft.title)
  pushField('shortTitle', '商品简称', current.shortTitle, draft.shortTitle)
  pushField('priceText', '价格信息', current.priceText, draft.priceText)
  pushField('promoText', '优惠信息', current.promoText, draft.promoText)
  pushField('stockText', '库存/状态', current.stockText, draft.stockText)
  pushField('aliases', '别名关键词', listToText(current.aliases), listToText(draft.aliases))
  pushField('highlights', '卖点/亮点', listToText(current.highlights), listToText(draft.highlights))
  pushField('faq', '商品 FAQ', faqToText(current.faq), faqToText(draft.faq))

  return fields
}

export function toFaqItems(
  faq?: Array<{
    q: string
    a: string
  }>,
): FaqItem[] {
  if (!faq?.length) {
    return [{ id: crypto.randomUUID(), q: '', a: '' }]
  }

  return faq.map(item => ({
    id: crypto.randomUUID(),
    q: item.q,
    a: item.a,
  }))
}
