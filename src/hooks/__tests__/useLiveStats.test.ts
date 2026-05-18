import { beforeEach, describe, expect, it } from 'vitest'

function createComment(id: string): LiveMessage {
  return {
    msg_type: 'comment',
    msg_id: id,
    nick_name: `用户${id}`,
    content: `评论${id}`,
    time: '12:00:00',
  }
}

describe('useLiveStatsStore message batching', () => {
  beforeEach(async () => {
    const { useLiveStatsStore } = await import('@/hooks/useLiveStats')
    useLiveStatsStore.setState({ contexts: {} })
  })

  it('handleMessages should match repeated handleMessage results', async () => {
    const { useLiveStatsStore } = await import('@/hooks/useLiveStats')

    const messages: LiveMessage[] = [
      createComment('1'),
      {
        msg_type: 'room_like',
        msg_id: 'like-1',
        nick_name: '点赞用户',
        user_id: 'user-like',
        time: '12:00:01',
      },
      {
        msg_type: 'ecom_fansclub_participate',
        msg_id: 'fans-1',
        nick_name: '粉丝用户',
        user_id: 'user-fans',
        content: '加入粉丝团',
        time: '12:00:02',
      },
      {
        msg_type: 'live_order',
        msg_id: 'order-1',
        nick_name: '下单用户',
        order_status: '已付款',
        order_ts: 123,
        product_id: 'product-1',
        product_title: '测试商品',
        time: '12:00:03',
      },
      createComment('2'),
    ]

    for (const message of messages) {
      useLiveStatsStore.getState().handleMessage('acc-single', message)
    }
    useLiveStatsStore.getState().handleMessages('acc-batch', messages)

    const single = useLiveStatsStore.getState().contexts['acc-single']
    const batch = useLiveStatsStore.getState().contexts['acc-batch']

    expect(batch.stats).toEqual(single.stats)
    expect(batch.danmuList.map(message => message.msg_id)).toEqual(
      single.danmuList.map(message => message.msg_id),
    )
    expect(batch.fansClubChanges).toEqual(single.fansClubChanges)
    expect(batch.events.map(event => event.id)).toEqual(single.events.map(event => event.id))
  })
})
