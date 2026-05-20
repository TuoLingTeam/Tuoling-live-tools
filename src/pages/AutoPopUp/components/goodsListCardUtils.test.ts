import { describe, expect, it } from 'vitest'
import { mergeGoodsByAutoFillResult } from './goodsListCardUtils'

describe('mergeGoodsByAutoFillResult', () => {
  it('以自动填充序号为准合并标题，不让部分标题扫描结果丢商品', () => {
    const result = mergeGoodsByAutoFillResult(
      [{ id: 2, title: '已有标题', interval: [1000, 2000] }],
      [1, 2, 3, 4],
      [{ id: 3, title: '扫描标题' }],
    )

    expect(result.map(item => item.id)).toEqual([1, 2, 3, 4])
    expect(result[1]).toMatchObject({
      id: 2,
      title: '已有标题',
      interval: [1000, 2000],
    })
    expect(result[2]).toEqual({ id: 3, title: '扫描标题' })
  })
})
