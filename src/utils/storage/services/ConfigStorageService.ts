/**
 * 配置存储服务
 * 统一管理各功能模块的配置数据
 */

import { storageManager } from '../StorageManager'
import type { StorageDataType, StorageLevel } from '../types'

/**
 * 配置存储服务选项
 */
export interface ConfigStorageServiceOptions {
  /** 数据类型 */
  dataType: StorageDataType
  /** 存储层级 */
  level: StorageLevel
  /** 用户ID */
  userId?: string
  /** 账号ID */
  accountId?: string
  /** 默认配置 */
  defaultConfig?: Record<string, unknown>
}

/**
 * 配置存储服务
 * 提供类型安全的配置存储接口
 */
export class ConfigStorageService<T extends Record<string, unknown>> {
  private options: ConfigStorageServiceOptions
  private defaultConfig: T

  constructor(options: ConfigStorageServiceOptions) {
    this.options = {
      ...options,
      defaultConfig: options.defaultConfig || {},
    }
    this.defaultConfig = (options.defaultConfig || {}) as T
  }

  /**
   * 获取配置
   */
  getConfig(): T {
    const data = storageManager.get<T>(this.options.dataType, {
      level: this.options.level,
      userId: this.options.userId,
      accountId: this.options.accountId,
    })

    return data || { ...this.defaultConfig }
  }

  /**
   * 保存配置
   */
  saveConfig(config: T): void {
    storageManager.set(this.options.dataType, config, {
      level: this.options.level,
      userId: this.options.userId,
      accountId: this.options.accountId,
    })
  }

  /**
   * 更新配置（部分更新）
   */
  updateConfig(updates: Partial<T>): void {
    const currentConfig = this.getConfig()
    const newConfig = { ...currentConfig, ...updates }
    this.saveConfig(newConfig as T)
  }

  /**
   * 获取指定配置项
   */
  get<K extends keyof T>(key: K): T[K] {
    const config = this.getConfig()
    return config[key] ?? this.defaultConfig[key]
  }

  /**
   * 设置指定配置项
   */
  set<K extends keyof T>(key: K, value: T[K]): void {
    const config = this.getConfig()
    config[key] = value
    this.saveConfig(config)
  }

  /**
   * 删除配置项
   */
  remove(key: keyof T): void {
    const config = this.getConfig()
    delete config[key]
    this.saveConfig(config)
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    this.saveConfig({ ...this.defaultConfig })
  }

  /**
   * 检查配置是否存在
   */
  exists(): boolean {
    return storageManager.has(this.options.dataType, {
      level: this.options.level,
      userId: this.options.userId,
      accountId: this.options.accountId,
    })
  }

  /**
   * 删除配置
   */
  delete(): void {
    storageManager.remove(this.options.dataType, {
      level: this.options.level,
      userId: this.options.userId,
      accountId: this.options.accountId,
    })
  }

  /**
   * 导出配置
   */
  export(): string {
    const config = this.getConfig()
    return JSON.stringify(config, null, 2)
  }

  /**
   * 导入配置
   */
  import(jsonString: string): boolean {
    try {
      const config = JSON.parse(jsonString) as T
      this.saveConfig(config)
      return true
    } catch (error) {
      console.error(
        `[ConfigStorageService] Failed to import config for ${this.options.dataType}:`,
        error,
      )
      return false
    }
  }
}

/**
 * 创建 Chrome 配置存储服务
 */
export function createChromeConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'chrome-config',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      path: '',
      selectedBrowserId: '',
      browsers: [],
      storageState: '',
      headless: false,
    },
  })
}

/**
 * 创建自动回复配置存储服务
 */
export function createAutoReplyConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'auto-reply',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      entry: 'control',
      hideUsername: false,
      comment: {
        keywordReply: {
          enable: false,
          rules: [],
        },
        aiReply: {
          enable: false,
          prompt: '',
          productPrompt: '',
          autoSend: false,
        },
      },
      blockList: [],
    },
  })
}

/**
 * 创建自动发言配置存储服务
 */
export function createAutoMessageConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'auto-message',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      scheduler: {
        interval: [30000, 60000],
      },
      messages: [],
      random: false,
      extraSpaces: false,
    },
  })
}

/**
 * 创建自动弹窗配置存储服务
 */
export function createAutoPopUpConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'auto-popup',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      scheduler: {
        interval: [30000, 45000],
      },
      goods: [],
      random: false,
      shortcuts: [],
    },
  })
}

/**
 * 创建直播控制配置存储服务
 */
export function createLiveControlConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'live-control',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      platform: 'buyin',
      status: 'disconnected',
    },
  })
}

/**
 * 创建小号互动配置存储服务
 */
export function createSubAccountConfigStorage(userId: string, accountId: string) {
  return new ConfigStorageService({
    dataType: 'sub-account',
    level: 'account',
    userId,
    accountId,
    defaultConfig: {
      accounts: [],
      isRunning: false,
    },
  })
}
