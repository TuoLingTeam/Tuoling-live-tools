export type KeywordReplyRule = {
  keywords: string[]
  contents: string[]
}

export const KEYWORD_REPLY_EXPORT_TYPE = 'xiuer-live-tools.keyword-reply-rules'
export const KEYWORD_REPLY_EXPORT_VERSION = 1
const CSV_HEADERS = ['关键词', '回复内容'] as const

function uniqueTrimmedList(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    const key = text.replace(/\s+/g, '')
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }

  return result
}

export function getCompleteKeywordReplyRules(rules: KeywordReplyRule[]) {
  return rules
    .map(rule => ({
      keywords: uniqueTrimmedList(rule.keywords),
      contents: uniqueTrimmedList(rule.contents),
    }))
    .filter(rule => rule.keywords.length > 0 && rule.contents.length > 0)
}

function normalizeImportRule(rule: unknown, index: number): KeywordReplyRule {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`第 ${index + 1} 条规则格式无效`)
  }

  const keywords = uniqueTrimmedList((rule as Partial<KeywordReplyRule>).keywords)
  const contents = uniqueTrimmedList((rule as Partial<KeywordReplyRule>).contents)

  if (keywords.length === 0) {
    throw new Error(`第 ${index + 1} 条规则缺少关键词`)
  }
  if (contents.length === 0) {
    throw new Error(`第 ${index + 1} 条规则缺少回复内容`)
  }

  return { keywords, contents }
}

function normalizeImportedRules(value: unknown): KeywordReplyRule[] {
  if (!Array.isArray(value)) {
    throw new Error('导入文件必须包含 rules 数组')
  }

  const rules = value.map(normalizeImportRule)
  if (rules.length === 0) {
    throw new Error('导入文件中没有关键词回复规则')
  }
  return rules
}

function getRulesCandidate(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return undefined

  const record = payload as {
    rules?: unknown
    comment?: { keywordReply?: { rules?: unknown } }
  }
  return record.rules ?? record.comment?.keywordReply?.rules
}

function stripBom(text: string) {
  return text.replace(/^\ufeff/u, '')
}

function escapeCsvCell(value: string) {
  const normalizedValue = value.replace(/\r\n|\r/gu, '\n')
  if (!/[",\n]/u.test(normalizedValue)) return normalizedValue
  return `"${normalizedValue.replace(/"/gu, '""')}"`
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const content = stripBom(text)

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const nextChar = content[index + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (inQuotes) {
    throw new Error('CSV 文件中存在未闭合的引号')
  }

  row.push(cell)
  if (row.some(value => value.trim()) || rows.length === 0) {
    rows.push(row)
  }

  return rows.filter(values => values.some(value => value.trim()))
}

function splitKeywordsCell(value: string) {
  return value.split(/\n|\/|、|；|;/u)
}

function splitContentsCell(value: string) {
  return value.split(/\n|\|/u)
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex(header => candidates.some(candidate => header.includes(candidate)))
}

export function serializeKeywordReplyRulesCsv(rules: KeywordReplyRule[]) {
  const completeRules = getCompleteKeywordReplyRules(rules)
  if (completeRules.length === 0) {
    throw new Error('当前没有可导出的完整关键词回复规则')
  }

  const lines = [
    CSV_HEADERS.map(escapeCsvCell).join(','),
    ...completeRules.map(rule =>
      [rule.keywords.join('\n'), rule.contents.join('\n')].map(escapeCsvCell).join(','),
    ),
  ]

  return `\ufeff${lines.join('\r\n')}\r\n`
}

export function serializeKeywordReplyRulesJson(
  rules: KeywordReplyRule[],
  exportedAt = new Date().toISOString(),
) {
  const completeRules = getCompleteKeywordReplyRules(rules)
  if (completeRules.length === 0) {
    throw new Error('当前没有可导出的完整关键词回复规则')
  }

  return JSON.stringify(
    {
      type: KEYWORD_REPLY_EXPORT_TYPE,
      version: KEYWORD_REPLY_EXPORT_VERSION,
      exportedAt,
      rules: completeRules,
    },
    null,
    2,
  )
}

export function parseKeywordReplyCsvText(text: string): KeywordReplyRule[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) {
    throw new Error('导入文件中没有关键词回复规则')
  }

  const headers = rows[0].map(value => value.trim().toLowerCase())
  const keywordIndex = findHeaderIndex(headers, ['关键词', 'keyword'])
  const contentIndex = findHeaderIndex(headers, ['回复内容', '回复', 'content'])
  const hasHeader = keywordIndex >= 0 && contentIndex >= 0
  const dataRows = hasHeader ? rows.slice(1) : rows
  const normalizedRules = dataRows.map((row, index) =>
    normalizeImportRule(
      {
        keywords: splitKeywordsCell(row[hasHeader ? keywordIndex : 0] ?? ''),
        contents: splitContentsCell(row[hasHeader ? contentIndex : 1] ?? ''),
      },
      index,
    ),
  )

  if (normalizedRules.length === 0) {
    throw new Error('导入文件中没有关键词回复规则')
  }
  return normalizedRules
}

export function parseKeywordReplyBulkText(text: string): KeywordReplyRule[] {
  const lines = text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error('导入文件中没有关键词回复规则')
  }

  return lines.map((line, index) => {
    const items = line.split('|')
    if (items.length < 2) {
      throw new Error(`第 ${index + 1} 行错误：请至少提供一个关键词和一条回复内容`)
    }

    return normalizeImportRule(
      {
        keywords: items[0].split('/'),
        contents: items.slice(1),
      },
      index,
    )
  })
}

export function parseKeywordReplyImportText(text: string): KeywordReplyRule[] {
  const trimmedText = stripBom(text).trim()
  if (!trimmedText) {
    throw new Error('导入文件内容为空')
  }

  if (/^[{[]/u.test(trimmedText)) {
    try {
      const payload = JSON.parse(trimmedText)
      return normalizeImportedRules(getRulesCandidate(payload))
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error('导入文件格式无效')
    }
  }

  if (trimmedText.split(/\r?\n/u)[0]?.includes(',')) {
    return parseKeywordReplyCsvText(trimmedText)
  }

  if (trimmedText.includes('|')) {
    return parseKeywordReplyBulkText(trimmedText)
  }

  try {
    return parseKeywordReplyCsvText(trimmedText)
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('导入文件格式无效')
  }
}
