/**
 * 存储管理器
 * 提供统一的存储管理接口
 */

import type {
  IStorageAdapter,
  StorageConfig,
  StorageDataType,
  StorageEntry,
  StorageEvent,
  StorageEventListener,
  StorageKeyOptions,
  StorageLevel,
  StorageOptions,
  StorageStats,
} from './types'

/**
 * 默认存储配置
 */
const DEFAULT_CONFIG: StorageConfig = {
  prefix: 'xiuer',
  defaultAdapter: 'localStorage',
  enableEncryption: false,
  enableMonitoring: true,
  enableValidation: true,
  maxStorageSize: 10 * 1024 * 1024, // 10MB
  storageVersion: 1,
}

const AUTO_REPLY_HISTORY_SESSION_LIMIT = 10
const AUTO_REPLY_HISTORY_ITEM_LIMIT = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactArray(value: unknown, limit: number): unknown {
  return Array.isArray(value) ? value.slice(0, limit) : value
}

/**
 * 存储管理器类
 */
export class StorageManager {
  private adapters: Map<string, IStorageAdapter> = new Map()
  private config: StorageConfig
  private eventListeners: Set<StorageEventListener> = new Set()
  private currentUserId: string | null = null

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 注册存储适配器
   */
  registerAdapter(adapter: IStorageAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  /**
   * 获取存储适配器
   */
  getAdapter(name?: string): IStorageAdapter {
    const adapterName = name || this.config.defaultAdapter
    const adapter = this.adapters.get(adapterName)
    if (!adapter) {
      throw new Error(`Storage adapter '${adapterName}' not found`)
    }
    return adapter
  }

  /**
   * 设置当前用户ID
   */
  setCurrentUser(userId: string | null): void {
    this.currentUserId = userId
  }

  /**
   * 获取当前用户ID
   */
  getCurrentUser(): string | null {
    return this.currentUserId
  }

  /**
   * 生成存储键
   */
  generateKey(options: StorageKeyOptions): string {
    const parts: string[] = [options.prefix, options.dataType]

    if (options.userId) {
      parts.push(options.userId)
    }

    if (options.accountId) {
      parts.push(options.accountId)
    }

    if (options.suffix) {
      parts.push(options.suffix)
    }

    return parts.join('-')
  }

  /**
   * 构建存储选项
   */
  private buildOptions(
    options: Partial<StorageOptions> & { dataType: StorageDataType },
  ): StorageOptions {
    const level: StorageLevel = options.level || 'user'

    return {
      level,
      dataType: options.dataType,
      userId: level !== 'global' ? options.userId || this.currentUserId || undefined : undefined,
      accountId: level === 'account' ? options.accountId : undefined,
      encrypted: options.encrypted ?? this.config.enableEncryption,
      ttl: options.ttl,
      version: options.version ?? this.config.storageVersion,
      suffix: options.suffix,
    }
  }

  /**
   * 获取存储键
   */
  private getStorageKey(options: StorageOptions): string {
    return this.generateKey({
      prefix: this.config.prefix,
      userId: options.userId,
      accountId: options.accountId,
      dataType: options.dataType,
      suffix: options.suffix,
    })
  }

  /**
   * 触发事件
   */
  private emitEvent(event: Omit<StorageEvent, 'timestamp'>): void {
    if (!this.config.enableMonitoring) return

    const fullEvent: StorageEvent = {
      ...event,
      timestamp: Date.now(),
    }

    this.eventListeners.forEach(listener => {
      try {
        listener(fullEvent)
      } catch (error) {
        console.error('[StorageManager] Event listener error:', error)
      }
    })
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: StorageEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: StorageEventListener): void {
    this.eventListeners.delete(listener)
  }

  /**
   * 存储数据
   */
  set<T>(
    dataType: StorageDataType,
    data: T,
    options: Partial<Omit<StorageOptions, 'dataType'>> = {},
  ): void {
    const fullOptions = this.buildOptions({ ...options, dataType })
    const key = this.getStorageKey(fullOptions)
    const adapter = this.getAdapter()

    try {
      const existingEntry = adapter.get<T>(key)
      const now = new Date().toISOString()
      const entry: StorageEntry<T> = {
        data,
        meta: {
          createdAt: existingEntry?.meta?.createdAt ?? now,
          updatedAt: now,
          version: fullOptions.version || 1,
          size: this.measureDataSize(data),
        },
      }

      // 检查存储配额
      if (this.config.enableValidation) {
        this.ensureQuotaForWrite(key, entry.meta.size ?? 0, existingEntry)
      }

      this.writeWithQuotaRecovery(key, entry)

      this.emitEvent({
        type: 'set',
        key,
        metadata: {
          dataType,
          level: fullOptions.level,
          size: entry.meta.size,
        },
      })
    } catch (error) {
      this.emitEvent({
        type: 'error',
        key,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  /**
   * 获取数据
   */
  get<T>(
    dataType: StorageDataType,
    options: Partial<Omit<StorageOptions, 'dataType'>> = {},
  ): T | null {
    const fullOptions = this.buildOptions({ ...options, dataType })
    const key = this.getStorageKey(fullOptions)
    const adapter = this.getAdapter()

    try {
      const entry = adapter.get<T>(key)

      if (!entry) {
        this.emitEvent({
          type: 'get',
          key,
          metadata: { dataType, found: false },
        })
        return null
      }

      // 检查过期时间
      const meta = entry.meta || {}
      if (fullOptions.ttl && meta.updatedAt) {
        const updatedAt = new Date(meta.updatedAt).getTime()
        if (Date.now() - updatedAt > fullOptions.ttl) {
          adapter.remove(key)
          this.emitEvent({
            type: 'get',
            key,
            metadata: { dataType, found: false, reason: 'expired' },
          })
          return null
        }
      }

      this.emitEvent({
        type: 'get',
        key,
        metadata: { dataType, found: true, version: meta.version || 1 },
      })

      return entry.data
    } catch (error) {
      this.emitEvent({
        type: 'error',
        key,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      return null
    }
  }

  /**
   * 删除数据
   */
  remove(dataType: StorageDataType, options: Partial<Omit<StorageOptions, 'dataType'>> = {}): void {
    const fullOptions = this.buildOptions({ ...options, dataType })
    const key = this.getStorageKey(fullOptions)
    const adapter = this.getAdapter()

    try {
      adapter.remove(key)
      this.emitEvent({
        type: 'remove',
        key,
        metadata: { dataType },
      })
    } catch (error) {
      this.emitEvent({
        type: 'error',
        key,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  /**
   * 检查数据是否存在
   */
  has(dataType: StorageDataType, options: Partial<Omit<StorageOptions, 'dataType'>> = {}): boolean {
    const fullOptions = this.buildOptions({ ...options, dataType })
    const key = this.getStorageKey(fullOptions)
    const adapter = this.getAdapter()

    return adapter.has(key)
  }

  /**
   * 获取存储统计信息
   */
  getStats(): StorageStats {
    const adapter = this.getAdapter()
    const keys = adapter.keys()
    const entriesByType: Record<StorageDataType, number> = {
      accounts: 0,
      'account-config': 0,
      'chrome-config': 0,
      'auto-reply': 0,
      'auto-reply-history': 0,
      'auto-message': 0,
      'auto-popup': 0,
      'live-control': 0,
      'task-recovery': 0,
      'sub-account': 0,
      'platform-pref': 0,
      'user-pref': 0,
      'account-pref': 0,
      auth: 0,
      theme: 0,
      other: 0,
    }

    let totalSize = 0
    let lastUpdated: string | null = null

    for (const key of keys) {
      const entry = adapter.get<unknown>(key)
      if (entry) {
        // 从键名解析数据类型
        const dataType = this.parseDataTypeFromKey(key)
        if (dataType) {
          entriesByType[dataType]++
        }

        // 安全地访问 meta 属性
        const meta = entry.meta || {}
        totalSize += meta.size || 0

        if (meta.updatedAt) {
          const updatedAt = new Date(meta.updatedAt)
          if (!lastUpdated || updatedAt > new Date(lastUpdated)) {
            lastUpdated = meta.updatedAt
          }
        }
      }
    }

    return {
      totalEntries: keys.length,
      totalSize,
      entriesByType,
      lastUpdated,
    }
  }

  /**
   * 从键名解析数据类型
   */
  private parseDataTypeFromKey(key: string): StorageDataType | null {
    const prefix = `${this.config.prefix}-`
    if (!key.startsWith(prefix)) {
      return null
    }

    const suffix = key.slice(prefix.length)
    const dataTypes = Object.keys(entriesByType).sort((a, b) => b.length - a.length)

    return (dataTypes.find(dataType => suffix === dataType || suffix.startsWith(`${dataType}-`)) ??
      null) as StorageDataType | null
  }

  /**
   * 检查本次写入后的存储配额
   */
  private ensureQuotaForWrite(
    key: string,
    nextSize: number,
    existingEntry: StorageEntry<unknown> | null,
  ): void {
    let stats = this.getStats()
    const existingSize = this.getEntrySize(existingEntry)
    let projectedSize = Math.max(0, stats.totalSize - existingSize + nextSize)

    if (projectedSize <= this.config.maxStorageSize) {
      return
    }

    this.emitQuotaExceeded(key, stats.totalSize, projectedSize, 'before-recovery')

    const recovery = this.compactRecoverableStorage(key)
    if (recovery.reclaimedSize > 0) {
      stats = this.getStats()
      projectedSize = Math.max(0, stats.totalSize - existingSize + nextSize)
    }

    if (projectedSize <= this.config.maxStorageSize || nextSize <= existingSize) {
      if (projectedSize > this.config.maxStorageSize) {
        this.emitQuotaExceeded(key, stats.totalSize, projectedSize, 'allowed-non-growing-write')
      }
      return
    }

    const error = new Error(
      `Storage quota exceeded: ${projectedSize} > ${this.config.maxStorageSize}`,
    )
    this.emitEvent({
      type: 'quota-exceeded',
      key,
      error,
      metadata: {
        currentSize: stats.totalSize,
        projectedSize,
        maxSize: this.config.maxStorageSize,
        existingSize,
        nextSize,
        reclaimedSize: recovery.reclaimedSize,
      },
    })
    throw error
  }

  private writeWithQuotaRecovery<T>(key: string, entry: StorageEntry<T>): void {
    const adapter = this.getAdapter()

    try {
      adapter.set(key, entry)
    } catch (error) {
      if (!this.isQuotaError(error)) {
        throw error
      }

      const recovery = this.compactRecoverableStorage(key)
      try {
        adapter.set(key, entry)
      } catch (retryError) {
        this.emitEvent({
          type: 'quota-exceeded',
          key,
          error: retryError instanceof Error ? retryError : new Error(String(retryError)),
          metadata: {
            maxSize: this.config.maxStorageSize,
            reclaimedSize: recovery.reclaimedSize,
            compactedEntries: recovery.compactedEntries,
          },
        })
        throw retryError
      }
    }
  }

  private compactRecoverableStorage(excludeKey: string): {
    compactedEntries: number
    reclaimedSize: number
  } {
    const adapter = this.getAdapter()
    let compactedEntries = 0
    let reclaimedSize = 0

    for (const key of adapter.keys()) {
      if (key === excludeKey || this.parseDataTypeFromKey(key) !== 'auto-reply-history') {
        continue
      }

      const entry = adapter.get<unknown>(key)
      if (!entry) {
        continue
      }

      const beforeSize = this.getEntrySize(entry)
      const compactedData = this.compactAutoReplyHistory(entry.data)
      const afterSize = this.measureDataSize(compactedData)

      if (afterSize >= beforeSize) {
        continue
      }

      adapter.set(key, {
        data: compactedData,
        meta: {
          ...entry.meta,
          updatedAt: new Date().toISOString(),
          size: afterSize,
        },
      })

      compactedEntries++
      reclaimedSize += beforeSize - afterSize
    }

    return { compactedEntries, reclaimedSize }
  }

  private compactAutoReplyHistory(data: unknown): unknown {
    if (!isRecord(data)) {
      return data
    }

    return {
      ...data,
      comments: compactArray(data.comments, AUTO_REPLY_HISTORY_ITEM_LIMIT),
      replies: compactArray(data.replies, AUTO_REPLY_HISTORY_ITEM_LIMIT),
      historySessions: Array.isArray(data.historySessions)
        ? data.historySessions.slice(0, AUTO_REPLY_HISTORY_SESSION_LIMIT).map(session => {
            if (!isRecord(session)) {
              return session
            }

            return {
              ...session,
              comments: compactArray(session.comments, AUTO_REPLY_HISTORY_ITEM_LIMIT),
              replies: compactArray(session.replies, AUTO_REPLY_HISTORY_ITEM_LIMIT),
            }
          })
        : data.historySessions,
    }
  }

  private emitQuotaExceeded(
    key: string,
    currentSize: number,
    projectedSize: number,
    phase: string,
  ): void {
    const error = new Error(
      `Storage quota exceeded: ${projectedSize} > ${this.config.maxStorageSize}`,
    )
    this.emitEvent({
      type: 'quota-exceeded',
      key,
      error,
      metadata: {
        phase,
        currentSize,
        projectedSize,
        maxSize: this.config.maxStorageSize,
      },
    })
  }

  private getEntrySize(entry: StorageEntry<unknown> | null): number {
    if (!entry) {
      return 0
    }

    return entry.meta?.size ?? this.measureDataSize(entry.data)
  }

  private measureDataSize(data: unknown): number {
    const serialized = JSON.stringify(data)
    return serialized?.length ?? 0
  }

  private isQuotaError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'QuotaExceededError' || error.message.includes('Storage quota exceeded'))
    )
  }

  /**
   * 清空用户数据
   */
  clearUserData(userId: string, preserveAccounts = true): void {
    const adapter = this.getAdapter()
    const keys = adapter.keys()
    const prefix = `${this.config.prefix}-`

    for (const key of keys) {
      if (key.startsWith(prefix)) {
        const parts = key.split('-')
        // 检查是否是该用户的数据
        const keyUserId = parts[2] // prefix-dataType-userId-...
        if (keyUserId === userId) {
          // 如果保留账号列表，跳过 accounts 类型
          if (preserveAccounts && parts[1] === 'accounts') {
            continue
          }
          adapter.remove(key)
        }
      }
    }

    this.emitEvent({
      type: 'clear',
      metadata: { userId, preserveAccounts },
    })
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    const adapter = this.getAdapter()
    adapter.clear()

    this.emitEvent({
      type: 'clear',
      metadata: { all: true },
    })
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    const adapter = this.getAdapter()
    return adapter.keys()
  }

  /**
   * 导出用户数据
   */
  exportUserData(userId: string): Record<string, unknown> {
    const adapter = this.getAdapter()
    const keys = adapter.keys()
    const data: Record<string, unknown> = {}
    const prefix = `${this.config.prefix}-`

    for (const key of keys) {
      if (key.startsWith(prefix)) {
        const parts = key.split('-')
        const keyUserId = parts[2]
        if (keyUserId === userId) {
          const entry = adapter.get<unknown>(key)
          if (entry) {
            data[key] = entry.data
          }
        }
      }
    }

    return data
  }

  /**
   * 导入用户数据
   */
  importUserData(userId: string, data: Record<string, unknown>): void {
    const adapter = this.getAdapter()

    for (const [key, value] of Object.entries(data)) {
      const entry: StorageEntry<unknown> = {
        data: value,
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: this.config.storageVersion,
          size: this.measureDataSize(value),
        },
      }
      adapter.set(key, entry)
    }

    this.emitEvent({
      type: 'set',
      metadata: { action: 'import', userId },
    })
  }
}

// 用于类型检查的对象
const entriesByType: Record<StorageDataType, number> = {
  accounts: 0,
  'account-config': 0,
  'chrome-config': 0,
  'auto-reply': 0,
  'auto-reply-history': 0,
  'auto-message': 0,
  'auto-popup': 0,
  'live-control': 0,
  'task-recovery': 0,
  'sub-account': 0,
  'platform-pref': 0,
  'user-pref': 0,
  'account-pref': 0,
  auth: 0,
  theme: 0,
  other: 0,
}

/**
 * 全局存储管理器实例
 */
export const storageManager = new StorageManager()
