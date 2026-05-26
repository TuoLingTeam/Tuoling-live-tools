import { describe, expect, it } from 'vitest'
import { buildHistoryAiGroupingKey } from '../AutoReplyHistorySheet'

describe('AutoReplyHistorySheet', () => {
  it('keeps the AI grouping key stable when only duplicate counts change', () => {
    const baseKey = buildHistoryAiGroupingKey(
      [
        {
          accountId: 'account-a',
          semanticKey: 'intent:order-confirmed',
        },
      ],
      'all',
    )
    const duplicateKey = buildHistoryAiGroupingKey(
      [
        {
          accountId: 'account-a',
          semanticKey: 'intent:order-confirmed',
        },
      ],
      'all',
    )

    expect(duplicateKey).toBe(baseKey)
  })

  it('changes the AI grouping key when a new uncovered semantic group appears', () => {
    const baseKey = buildHistoryAiGroupingKey(
      [
        {
          accountId: 'account-a',
          semanticKey: 'intent:order-confirmed',
        },
      ],
      'all',
    )
    const nextKey = buildHistoryAiGroupingKey(
      [
        {
          accountId: 'account-a',
          semanticKey: 'intent:order-confirmed',
        },
        {
          accountId: 'account-a',
          semanticKey: 'intent:shipping',
        },
      ],
      'all',
    )

    expect(nextKey).not.toBe(baseKey)
  })
})
