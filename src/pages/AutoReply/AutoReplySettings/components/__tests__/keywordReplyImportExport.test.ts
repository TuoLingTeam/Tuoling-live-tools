import { describe, expect, it } from 'vitest'
import {
  KEYWORD_REPLY_EXPORT_TYPE,
  parseKeywordReplyBulkText,
  parseKeywordReplyCsvText,
  parseKeywordReplyImportText,
  serializeKeywordReplyRulesCsv,
} from '../keywordReplyImportExport'

describe('keywordReplyImportExport', () => {
  it('serializes complete keyword reply rules as an Excel-friendly CSV table', () => {
    const csv = serializeKeywordReplyRulesCsv([
      {
        keywords: [' 发货 ', '发货', '物流'],
        contents: ['今天发', ' 今天发 ', '明天到'],
      },
      {
        keywords: [],
        contents: ['不完整规则不会导出'],
      },
    ])

    expect(csv).toBe('\ufeff关键词,回复内容\r\n"发货\n物流","今天发\n明天到"\r\n')
    expect(parseKeywordReplyCsvText(csv)).toEqual([
      {
        keywords: ['发货', '物流'],
        contents: ['今天发', '明天到'],
      },
    ])
  })

  it('parses exported JSON payloads and bare rule arrays for compatibility', () => {
    expect(
      parseKeywordReplyImportText(
        JSON.stringify({
          type: KEYWORD_REPLY_EXPORT_TYPE,
          version: 1,
          exportedAt: '2026-05-23T00:00:00.000Z',
          rules: [
            {
              keywords: ['价格'],
              contents: ['今天 19 块 8'],
            },
          ],
        }),
      ),
    ).toEqual([{ keywords: ['价格'], contents: ['今天 19 块 8'] }])

    expect(
      parseKeywordReplyImportText('[{"keywords":["券"],"contents":["点左下角领券"]}]'),
    ).toEqual([{ keywords: ['券'], contents: ['点左下角领券'] }])
  })

  it('parses CSV tables with headers', () => {
    const rules = parseKeywordReplyImportText(
      '\ufeff关键词,回复内容\r\n"发货\n物流","今天发\n默认包邮"',
    )

    expect(rules).toEqual([
      {
        keywords: ['发货', '物流'],
        contents: ['今天发', '默认包邮'],
      },
    ])
  })

  it('parses bulk editor text as an import format', () => {
    expect(parseKeywordReplyBulkText('发货/物流|今天发|默认包邮')).toEqual([
      {
        keywords: ['发货', '物流'],
        contents: ['今天发', '默认包邮'],
      },
    ])
  })

  it('rejects invalid import content', () => {
    expect(() =>
      parseKeywordReplyImportText('{"rules":[{"keywords":[],"contents":["回复"]}]}'),
    ).toThrow('缺少关键词')
    expect(() => parseKeywordReplyImportText('not-json')).toThrow()
  })
})
