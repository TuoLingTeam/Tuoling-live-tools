/**
 * 存储系统初始化模块
 * 初始化存储管理器并注册适配器
 *
 * 首发版：移除数据迁移逻辑，不需要兼容旧版本
 */

import { LocalStorageAdapter } from './adapters/LocalStorageAdapter'
import { storageMonitor } from './monitor/StorageMonitor'
import { storageManager } from './StorageManager'

/**
 * 初始化存储系统
 */
export function initializeStorage(): void {
  const enableStorageDiagnostics = import.meta.env.DEV

  // 注册适配器
  const localStorageAdapter = new LocalStorageAdapter()
  storageManager.registerAdapter(localStorageAdapter)

  if (enableStorageDiagnostics) {
    storageManager.addEventListener(event => {
      storageMonitor.recordEvent(event)
    })

    storageMonitor.addAlertListener(alert => {
      console.warn('[Storage Alert]', alert)
    })
  }
}

/**
 * 为用户初始化存储
 * 登录时调用
 */
export function initializeUserStorage(userId: string): void {
  // 设置当前用户
  storageManager.setCurrentUser(userId)

  // 首发版：不需要数据迁移，所有数据都是新格式
}

/**
 * 清理用户存储
 * 登出时调用
 */
export function cleanupUserStorage(userId: string, preserveAccounts = true): void {
  // 清理用户数据（保留账号列表）
  storageManager.clearUserData(userId, preserveAccounts)

  // 清除当前用户
  storageManager.setCurrentUser(null)
}

/**
 * 获取存储健康状态
 */
export function getStorageHealth(): {
  healthy: boolean
  stats: ReturnType<typeof storageManager.getStats> | null
  report: ReturnType<typeof storageMonitor.generateReport>
} {
  try {
    const stats = storageManager.getStats()
    const report = storageMonitor.generateReport()

    return {
      healthy: report.errorRate < 0.1 && stats.totalSize < 4 * 1024 * 1024,
      stats,
      report,
    }
  } catch {
    // 存储未初始化时返回默认值
    return {
      healthy: false,
      stats: null,
      report: storageMonitor.generateReport(),
    }
  }
}
