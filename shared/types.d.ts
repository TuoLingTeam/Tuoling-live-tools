declare type StreamStatus = 'unknown' | 'offline' | 'live' | 'ended'

declare type Account = {
  readonly id: string
  name: string
  platform?: LiveControlPlatform
}

declare type LiveControlPlatform =
  | 'douyin'
  | 'buyin'
  | 'eos'
  | 'xiaohongshu'
  | 'pgy'
  | 'wxchannel'
  | 'kuaishou'
  | 'taobao'
  | 'dev'

/**
 * 单个商品配置
 * 支持为每个商品单独设置弹窗间隔
 */
declare type GoodsItemConfig = {
  id: number
  interval?: [number, number] // 可选：单独设置间隔（毫秒），未设置则使用全局默认值
  title?: string
  shortTitle?: string
  priceText?: string
  promoText?: string
  stockText?: string
  highlights?: string[]
  aliases?: string[]
  faq?: Array<{
    q: string
    a: string
  }>
}

declare type AutoPopupConfig = {
  scheduler: {
    interval: [number, number] // 全局默认间隔（毫秒）
  }
  goods: GoodsItemConfig[] // 商品配置列表
  random?: boolean
}

declare type AutoPopupTask = {
  type: 'auto-popup'
  config: AutoPopupConfig
}

declare type AutoCommentConfig = {
  scheduler: {
    interval: [number, number]
  }
  messages: {
    content: string
    pinTop: boolean
  }[]
  random?: boolean
  extraSpaces?: boolean
}

declare type AutoCommentTask = {
  type: 'auto-comment'
  config: AutoCommentConfig
}

declare type SendBatchMessagesConfig = {
  messages: string[]
  count: number
  noSpace?: boolean
}

declare type SendBatchMessagesTask = {
  type: 'send-batch-messages'
  config: SendBatchMessagesConfig
}

declare interface CommentListenerConfig {
  source: 'compass' | 'control' | 'wechat-channel' | 'xiaohongshu' | 'taobao'
  ws?: {
    port: number
  }
}

declare type CommentListenerTask = {
  type: 'comment-listener'
  config: CommentListenerConfig
}

declare type PinCommentTask = {
  type: 'pin-comment'
  config: {
    comment: string
  }
}

declare type SubAccountConfig = {
  id: string
  name: string
  platform: LiveControlPlatform
  cookies?: string // 可选：预设的登录态
  group?: string // 可选：分组名称
}

declare type SubAccountGroup = {
  id: string
  name: string
  accountIds: string[]
  enabled: boolean
}

declare type SubAccountInteractionConfig = {
  scheduler: {
    interval: [number, number] // 发送间隔范围（秒）
  }
  liveRoomUrl?: string // 小号自动进房使用的直播间地址
  messages: {
    id?: string // 前端需要 ID 字段
    content: string
    weight?: number // 消息权重，用于随机选择
  }[]
  random?: boolean // 是否随机选择消息
  extraSpaces?: boolean // 是否插入随机空格
  rotateAccounts?: boolean // 是否轮换使用小号
  rotateGroups?: boolean // 是否轮换使用分组
  accounts: SubAccountConfig[]
  groups?: SubAccountGroup[] // 可选：分组配置
}

declare type SubAccountInteractionTask = {
  type: 'sub-account-interaction'
  config: SubAccountInteractionConfig
}

declare type LiveControlTask =
  | AutoPopupTask
  | AutoCommentTask
  | SendBatchMessagesTask
  | CommentListenerTask
  | PinCommentTask
  | SubAccountInteractionTask

declare type DouyinLiveMessage = {
  time: string
} & (
  | CommentMessage
  | RoomEnterMessage
  | RoomLikeMessage
  | LiveOrderMessage
  | SubscribeMerchantBrandVipMessage
  | RoomFollowMessage
  | EcomFansclubParticipateMessage
)

interface CommentMessage {
  msg_type: 'comment'
  msg_id: string
  nick_name: string
  content: string
}

interface RoomEnterMessage {
  msg_type: 'room_enter'
  msg_id: string
  nick_name: string
  user_id: string
}

interface RoomLikeMessage {
  msg_type: 'room_like'
  msg_id: string
  nick_name: string
  user_id: string
}

interface SubscribeMerchantBrandVipMessage {
  msg_type: 'subscribe_merchant_brand_vip'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface RoomFollowMessage {
  msg_type: 'room_follow'
  msg_id: string
  nick_name: string
  user_id: string
}

interface EcomFansclubParticipateMessage {
  msg_type: 'ecom_fansclub_participate'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
}

interface LiveOrderMessage {
  msg_type: 'live_order'
  nick_name: string
  msg_id: string
  order_status: '已下单' | '已付款' | '未知状态'
  order_ts: number
  product_id: string
  product_title: string
}

declare type WechatChannelLiveMessage = {
  msg_type: 'wechat_channel_live_msg'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: string
}

declare type XiaohongshuCommentLiveMessage = {
  msg_type: 'xiaohongshu_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: string
}

declare type TaobaoCommentLiveMessage = {
  msg_type: 'taobao_comment'
  msg_id: string
  nick_name: string
  user_id: string
  content: string
  time: string
}

declare type LiveMessage =
  | WechatChannelLiveMessage
  | DouyinLiveMessage
  | XiaohongshuCommentLiveMessage
  | TaobaoCommentLiveMessage
