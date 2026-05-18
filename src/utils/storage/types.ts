/**
 * 统一存储系统类型定义
 */

// zod 类型导入（可选依赖）
declare type ZodType<T> = {
  parse: (data: unknown) => T
  safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: Error }
}

/**
 * 存储层级类型
 */
export type StorageLevel = 'global' | 'user' | 'account'

/**
 * 存储数据类型
 */
export type StorageDataType =
  | 'accounts' // 账号列表
  | 'account-config' // 账号配置
  | 'chrome-config' // Chrome配置
  | 'auto-reply' // 自动回复配置
  | 'auto-reply-history' // 自动回复历史
  | 'auto-message' // 自动发言配置
  | 'auto-popup' // 自动弹窗配置
  | 'live-control' // 直播控制配置
  | 'task-recovery' // 任务崩溃恢复意图
  | 'sub-account' // 小号互动配置
  | 'platform-pref' // 平台偏好
  | 'user-pref' // 用户偏好
  | 'account-pref' // 账号偏好
  | 'auth' // 认证信息
  | 'theme' // 主题设置
  | 'other' // 其他

/**
 * 存储选项
 */
export interface StorageOptions {
  /** 存储层级 */
  level: StorageLevel
  /** 数据类型 */
  dataType: StorageDataType
  /** 用户ID（user/account 层级必需） */
  userId?: string
  /** 账号ID（account 层级必需） */
  accountId?: string
  /** 是否加密存储 */
  encrypted?: boolean
  /** 过期时间（毫秒） */
  ttl?: number
  /** 版本号，用于数据迁移 */
  version?: number
  /** 自定义后缀 */
  suffix?: string
}

/**
 * 存储元数据
 */
export interface StorageMetadata {
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
  /** 版本号 */
  version: number
  /** 数据校验和 */
  checksum?: string
  /** 数据大小（字节） */
  size?: number
}

/**
 * 存储条目
 */
export interface StorageEntry<T = unknown> {
  /** 存储的数据 */
  data: T
  /** 元数据 */
  meta: StorageMetadata
}

/**
 * 存储适配器接口
 */
export interface IStorageAdapter {
  /** 适配器名称 */
  readonly name: string
  /** 是否可用 */
  readonly isAvailable: boolean

  /**
   * 获取存储项
   */
  get<T>(key: string): StorageEntry<T> | null

  /**
   * 设置存储项
   */
  set<T>(key: string, entry: StorageEntry<T>): void

  /**
   * 删除存储项
   */
  remove(key: string): void

  /**
   * 清空所有存储
   */
  clear(): void

  /**
   * 获取所有键
   */
  keys(): string[]

  /**
   * 检查键是否存在
   */
  has(key: string): boolean
}

/**
 * 存储事件类型
 */
export type StorageEventType =
  | 'get'
  | 'set'
  | 'remove'
  | 'clear'
  | 'migrate'
  | 'error'
  | 'quota-exceeded'

/**
 * 存储事件
 */
export interface StorageEvent {
  type: StorageEventType
  key?: string
  timestamp: number
  error?: Error
  metadata?: Record<string, unknown>
}

/**
 * 存储事件监听器
 */
export type StorageEventListener = (event: StorageEvent) => void

/**
 * 存储统计信息
 */
export interface StorageStats {
  /** 总条目数 */
  totalEntries: number
  /** 总大小（字节） */
  totalSize: number
  /** 各数据类型的条目数 */
  entriesByType: Record<StorageDataType, number>
  /** 最后更新时间 */
  lastUpdated: string | null
}

/**
 * 迁移策略
 */
export interface MigrationStrategy {
  /** 源版本 */
  fromVersion: number
  /** 目标版本 */
  toVersion: number
  /** 迁移函数 */
  migrate: (data: unknown) => unknown
}

/**
 * 数据验证器
 */
export interface DataValidator<T> {
  /** Zod schema */
  schema: ZodType<T>
  /** 版本号 */
  version: number
}

/**
 * 存储配置
 */
export interface StorageConfig {
  /** 存储前缀 */
  prefix: string
  /** 默认适配器 */
  defaultAdapter: string
  /** 是否启用加密 */
  enableEncryption: boolean
  /** 是否启用监控 */
  enableMonitoring: boolean
  /** 是否启用数据验证 */
  enableValidation: boolean
  /** 最大存储大小（字节） */
  maxStorageSize: number
  /** 存储版本 */
  storageVersion: number
}

/**
 * 账号数据接口
 */
export interface AccountData {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/**
 * 用户数据接口
 */
export interface UserData {
  accounts: AccountData[]
  currentAccountId: string
  defaultAccountId: string | null
  preferences: Record<string, unknown>
  lastLoginAt: string | null
}

/**
 * 存储键生成选项
 */
export interface StorageKeyOptions {
  prefix: string
  userId?: string
  accountId?: string
  dataType: StorageDataType
  suffix?: string
}
