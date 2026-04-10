// 平台配置映射表 - 单一事实来源
export const PLATFORM_CONFIG = {
  douyin: {
    id: 'douyin',
    name: '抖音小店',
    loginUrl: 'https://fxg.jinritemai.com/ffa/buyin/dashboard/live/control',
    loginRedirectUrl: 'https://fxg.jinritemai.com/ffa/buyin/dashboard/live/control',
    verify: {
      method: 'url',
      pattern: /fxg\.jinritemai\.com\/.*live.*control/,
      cookieKey: 'sessionid',
      localStorageKey: 'user_info',
    },
  },
  buyin: {
    id: 'buyin',
    name: '巨量百应',
    loginUrl: 'https://buyin.jinritemai.com/dashboard/live/control',
    loginRedirectUrl: 'https://buyin.jinritemai.com/dashboard/live/control',
    verify: {
      method: 'url',
      pattern: /buyin\.jinritemai\.com\/.*live.*control/,
      cookieKey: 'sessionid',
      localStorageKey: 'user_info',
    },
  },
  eos: {
    id: 'eos',
    name: '抖音团购',
    loginUrl: 'https://compass.jinritemai.com/screen/anchor/shop',
    loginRedirectUrl: 'https://compass.jinritemai.com/screen/anchor/shop',
    verify: {
      method: 'url',
      pattern: /compass\.jinritemai\.com\/screen/,
      cookieKey: 'sessionid',
      localStorageKey: 'user_info',
    },
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书千帆',
    loginUrl: 'https://ark.xiaohongshu.com/ark/web/center/marketing/live',
    loginRedirectUrl: 'https://ark.xiaohongshu.com/ark/web/center/marketing/live',
    verify: {
      method: 'url',
      pattern: /ark\.xiaohongshu\.com\/.*live/,
      cookieKey: 'web_session',
      localStorageKey: 'user_info',
    },
  },
  pgy: {
    id: 'pgy',
    name: '小红书蒲公英',
    loginUrl: 'https://pgy.xiaohongshu.com/platform/live/room',
    loginRedirectUrl: 'https://pgy.xiaohongshu.com/platform/live/room',
    verify: {
      method: 'url',
      pattern: /pgy\.xiaohongshu\.com\/.*live/,
      cookieKey: 'web_session',
      localStorageKey: 'user_info',
    },
  },
  wxchannel: {
    id: 'wxchannel',
    name: '视频号',
    loginUrl: 'https://channels.weixin.qq.com/',
    loginRedirectUrl: 'https://channels.weixin.qq.com/',
    verify: {
      method: 'url',
      pattern: /channels\.weixin\.qq\.com/,
      cookieKey: 'web_session',
      localStorageKey: 'user_info',
    },
  },
  kuaishou: {
    id: 'kuaishou',
    name: '快手小店',
    loginUrl: 'https://live.kuaishou.com/shop/live',
    loginRedirectUrl: 'https://live.kuaishou.com/shop/live',
    verify: {
      method: 'url',
      pattern: /live\.kuaishou\.com\/.*live/,
      cookieKey: 'sessionid',
      localStorageKey: 'user_info',
    },
  },
  taobao: {
    id: 'taobao',
    name: '淘宝',
    loginUrl: 'https://live.taobao.com/',
    loginRedirectUrl: 'https://live.taobao.com/',
    verify: {
      method: 'url',
      pattern: /live\.taobao\.com/,
      cookieKey: 'sessionid',
      localStorageKey: 'user_info',
    },
  },
}

// 连接阶段 - 用于进度条显示
export type ConnectionPhase =
  | 'idle' // 未开始
  | 'preparing' // 准备连接
  | 'recovering' // 正在自动恢复连接
  | 'launching_browser' // 启动浏览器
  | 'waiting_for_login' // 等待用户扫码登录
  | 'verifying_session' // 验证登录会话
  | 'streaming' // 开始直播
  | 'tasks_running' // 任务运行中
  | 'error' // 连接失败

// 连接状态管理 - 单一事实来源
export interface ConnectState {
  platform: string
  status: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'
  phase: ConnectionPhase // 详细的连接阶段
  session: string | null
  lastVerifiedAt: number | null
  error: string | null
}

export const DEFAULT_CONNECT_STATE: ConnectState = {
  platform: '',
  status: 'disconnected',
  phase: 'idle',
  session: null,
  lastVerifiedAt: null,
  error: null,
}
