import { useMemo, useRef } from 'react'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { EVENTS, eventEmitter } from '@/utils/events'
import { useAccounts } from './useAccounts'

// 消息类型统计
export interface MessageStats {
  // 点赞数
  likeCount: number
  // 弹幕/评论数
  commentCount: number
  // 进入直播间人数
  enterCount: number
  // 关注数
  followCount: number
  // 加入粉丝团数
  fansClubCount: number
  // 订单数（已下单）
  orderCount: number
  // 订单数（已付款）
  paidOrderCount: number
  // 品牌会员数
  brandVipCount: number
}

// 粉丝团变化记录
export interface FansClubChange {
  id: string
  nickName: string
  userId?: string
  content?: string
  time: string
}

// 事件记录
export interface LiveEvent {
  id: string
  type: LiveMessage['msg_type']
  nickName: string
  userId?: string // 导出用户行为明细时用于聚合
  content?: string
  time: string
  extra?: Record<string, unknown>
}

// 单个账号的统计上下文
interface LiveStatsContext {
  // 统计数据
  stats: MessageStats
  // 弹幕列表（最近100条）
  danmuList: LiveMessage[]
  // 粉丝团变化列表（最近50条）
  fansClubChanges: FansClubChange[]
  // 事件列表（最近100条）
  events: LiveEvent[]
  // 监听开始时间
  startTime: number | null
  // 是否正在监听
  isListening: boolean
}

interface LiveStatsState {
  contexts: Record<string, LiveStatsContext>
}

interface LiveStatsActions {
  // 初始化/重置统计
  resetStats: (accountId: string) => void
  // 设置监听状态
  setListening: (accountId: string, isListening: boolean) => void
  // 处理新消息
  handleMessage: (accountId: string, message: LiveMessage) => void
  // 批量处理新消息
  handleMessages: (accountId: string, messages: LiveMessage[]) => void
}

const MAX_DANMU_LIST = 100
const MAX_FANS_CLUB_CHANGES = 50
const MAX_EVENTS = 100

const createDefaultContext = (): LiveStatsContext => ({
  stats: {
    likeCount: 0,
    commentCount: 0,
    enterCount: 0,
    followCount: 0,
    fansClubCount: 0,
    orderCount: 0,
    paidOrderCount: 0,
    brandVipCount: 0,
  },
  danmuList: [],
  fansClubChanges: [],
  events: [],
  startTime: null,
  isListening: false,
})

function applyLiveStatsMessage(context: LiveStatsContext, message: LiveMessage) {
  // 创建事件记录（userId 用于导出时的用户级聚合）
  const event: LiveEvent = {
    id: message.msg_id || crypto.randomUUID(),
    type: message.msg_type,
    nickName: message.nick_name,
    userId: (message as { user_id?: string }).user_id,
    time: message.time,
  }

  // 根据消息类型更新统计
  switch (message.msg_type) {
    case 'room_like':
      context.stats.likeCount++
      break

    case 'comment':
    case 'wechat_channel_live_msg':
    case 'xiaohongshu_comment':
    case 'taobao_comment':
      context.stats.commentCount++
      context.danmuList = [message, ...context.danmuList].slice(0, MAX_DANMU_LIST)
      event.content = (message as CommentMessage).content
      break

    case 'room_enter':
      context.stats.enterCount++
      break

    case 'room_follow':
      context.stats.followCount++
      break

    case 'ecom_fansclub_participate':
      context.stats.fansClubCount++
      context.fansClubChanges = [
        {
          id: message.msg_id,
          nickName: message.nick_name,
          userId: message.user_id,
          content: message.content,
          time: message.time,
        },
        ...context.fansClubChanges,
      ].slice(0, MAX_FANS_CLUB_CHANGES)
      event.content = message.content
      break

    case 'live_order':
      context.stats.orderCount++
      if (message.order_status === '已付款') {
        context.stats.paidOrderCount++
      }
      event.content = message.product_title
      event.extra = {
        orderStatus: message.order_status,
        productId: message.product_id,
        orderTs: message.order_ts,
      }
      break

    case 'subscribe_merchant_brand_vip':
      context.stats.brandVipCount++
      event.content = message.content
      break
  }

  context.events = [event, ...context.events].slice(0, MAX_EVENTS)
}

export const useLiveStatsStore = create<LiveStatsState & LiveStatsActions>()(
  immer(set => {
    // 监听账号移除事件
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
      })
    })

    const ensureContext = (state: LiveStatsState, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = createDefaultContext()
      }
      return state.contexts[accountId]
    }

    return {
      contexts: {},

      resetStats: accountId =>
        set(state => {
          const context = ensureContext(state, accountId)
          // 只重置统计数据，保留监听状态
          const wasListening = context.isListening
          context.stats = {
            likeCount: 0,
            commentCount: 0,
            enterCount: 0,
            followCount: 0,
            fansClubCount: 0,
            orderCount: 0,
            paidOrderCount: 0,
            brandVipCount: 0,
          }
          context.danmuList = []
          context.fansClubChanges = []
          context.events = []
          // 如果正在监听，重置开始时间为当前时间
          context.startTime = wasListening ? Date.now() : null
        }),

      setListening: (accountId, isListening) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isListening = isListening
          if (isListening && !context.startTime) {
            context.startTime = Date.now()
          }
          // 停止监听时不清空 startTime，保留上次的开始时间用于显示
        }),

      handleMessage: (accountId, message) =>
        set(state => {
          const context = ensureContext(state, accountId)
          applyLiveStatsMessage(context, message)
        }),

      handleMessages: (accountId, messages) =>
        set(state => {
          if (messages.length === 0) {
            return
          }

          const context = ensureContext(state, accountId)
          for (const message of messages) {
            applyLiveStatsMessage(context, message)
          }
        }),
    }
  }),
)

/**
 * 直播数据统计 Hook
 * 用于获取当前账号的直播统计数据
 */
export function useLiveStats() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const defaultContextRef = useRef(createDefaultContext())
  const context = useLiveStatsStore(
    state => state.contexts[currentAccountId] ?? defaultContextRef.current,
  )
  const resetStats = useLiveStatsStore(state => state.resetStats)
  const setListening = useLiveStatsStore(state => state.setListening)
  const handleMessage = useLiveStatsStore(state => state.handleMessage)
  const handleMessages = useLiveStatsStore(state => state.handleMessages)

  const { stats, danmuList, fansClubChanges, events, startTime, isListening } = context

  // 计算直播时长（秒）
  const durationSeconds = useMemo(() => {
    if (!startTime) return 0
    return Math.floor((Date.now() - startTime) / 1000)
  }, [startTime])

  return {
    // 统计数据
    stats,
    // 弹幕列表
    danmuList,
    // 粉丝团变化
    fansClubChanges,
    // 事件列表
    events,
    // 监听状态
    isListening,
    // 直播时长
    durationSeconds,
    // 开始时间
    startTime,

    // Actions
    resetStats: () => resetStats(currentAccountId),
    setListening: (listening: boolean) => setListening(currentAccountId, listening),
    handleMessage: (message: LiveMessage) => handleMessage(currentAccountId, message),
    handleMessages: (messages: LiveMessage[]) => handleMessages(currentAccountId, messages),
  }
}

/**
 * 格式化数字显示
 * 超过1万显示为 x.xx万
 */
export function formatCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(2)}万`
  }
  return count.toString()
}

/**
 * 格式化时长显示
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}
