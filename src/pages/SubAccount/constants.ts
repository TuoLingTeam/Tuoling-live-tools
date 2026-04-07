export const DEFAULT_PRESET_CATEGORIES = [
  {
    id: 'warmup',
    name: '暖场',
    description: '直播开始时的暖场话术',
    messages: [
      { id: 'warmup-1', content: '来了来了', weight: 1 },
      { id: 'warmup-2', content: '支持{主播/主播大大}', weight: 1 },
      { id: 'warmup-3', content: '今天直播{几点/什么时候}结束呀', weight: 1 },
      { id: 'warmup-4', content: '刚下班就赶来了', weight: 1 },
      { id: 'warmup-5', content: '终于等到开播了', weight: 1 },
    ],
  },
  {
    id: 'interaction',
    name: '互动',
    description: '直播过程中的互动话术',
    messages: [
      { id: 'interaction-1', content: '666', weight: 2 },
      { id: 'interaction-2', content: '赞', weight: 2 },
      { id: 'interaction-3', content: '主播讲得太好了', weight: 1 },
      { id: 'interaction-4', content: '这个{产品/商品}怎么样', weight: 1 },
      { id: 'interaction-5', content: '有{优惠/活动}吗', weight: 1 },
      { id: 'interaction-6', content: '已拍，求{加急/尽快}发货', weight: 1 },
    ],
  },
  {
    id: 'question',
    name: '提问',
    description: '询问商品相关问题',
    messages: [
      { id: 'question-1', content: '这个怎么用呀', weight: 1 },
      { id: 'question-2', content: '适合{什么/哪些}人群', weight: 1 },
      { id: 'question-3', content: '保质期{多久/多长时间}', weight: 1 },
      { id: 'question-4', content: '现在下单{多久/什么时候}能到', weight: 1 },
      { id: 'question-5', content: '还有{库存/货}吗', weight: 1 },
    ],
  },
  {
    id: 'emotion',
    name: '情感',
    description: '表达对主播的支持和喜爱',
    messages: [
      { id: 'emotion-1', content: '主播今天{好美/好帅}', weight: 1 },
      { id: 'emotion-2', content: '{喜欢/爱}了{喜欢/爱}了', weight: 1 },
      { id: 'emotion-3', content: '主播{声音/讲解}真好听', weight: 1 },
      { id: 'emotion-4', content: '{良心/宝藏}主播', weight: 1 },
      { id: 'emotion-5', content: '关注主播{好久/很久了}', weight: 1 },
    ],
  },
  {
    id: 'purchase',
    name: '购买',
    description: '表达购买意向的话术',
    messages: [
      { id: 'purchase-1', content: '已下单', weight: 1 },
      { id: 'purchase-2', content: '{买/拍}了{买/拍}了', weight: 1 },
      { id: 'purchase-3', content: '这个{价格/价位}很{划算/合适}', weight: 1 },
      { id: 'purchase-4', content: '{准备/打算}入手', weight: 1 },
      { id: 'purchase-5', content: '{推荐/安利}给{朋友/闺蜜}了', weight: 1 },
    ],
  },
] as const

export type LoginStateBadgeVariant = 'success' | 'warning' | 'info' | 'destructive' | 'neutral'

export const UNGROUPED_SELECT_VALUE = '__ungrouped__'

export const VIEWER_PLATFORMS = {
  douyin: '抖音',
  buyin: '抖音',
  xiaohongshu: '小红书',
  wxchannel: '视频号',
  taobao: '淘宝直播',
  kuaishou: '快手',
} as const

export type ViewerPlatformKey = keyof typeof VIEWER_PLATFORMS

// 消息模板变量说明
export const MESSAGE_VARIABLES = [
  { variable: '{A/B}', description: '随机选择 A 或 B', example: '{你好/您好}' },
  { variable: '{streamer}', description: '主播名称', example: '支持{streamer}' },
  { variable: '{time}', description: '当前时间', example: '现在{time}了' },
  { variable: '{date}', description: '当前日期', example: '{date}直播' },
  { variable: '{random:1-10}', description: '随机数字', example: '第{random:1-100}名' },
] as const
