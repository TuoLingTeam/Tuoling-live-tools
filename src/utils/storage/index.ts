/**
 * 统一数据存储管理系统
 * Unified Data Storage Management System
 *
 * 提供集中式的数据存储、读取、迁移和监控功能
 * 解决现有存储逻辑分散、不一致的问题
 */

// 导出存储适配器
export { LocalStorageAdapter } from './adapters/LocalStorageAdapter'
export { useAccountStorage } from './hooks/useAccountStorage'
// 导出 Hook
export { useStorage } from './hooks/useStorage'
// 导出初始化函数
export {
  cleanupUserStorage,
  getStorageHealth,
  initializeStorage,
  initializeUserStorage,
} from './init'
// 导出监控工具
export { StorageMonitor } from './monitor/StorageMonitor'
// 导出存储管理器
export { StorageManager, storageManager } from './StorageManager'
// 导出存储服务
export { AccountStorageService } from './services/AccountStorageService'
export { ConfigStorageService } from './services/ConfigStorageService'
export { PreferenceStorageService } from './services/PreferenceStorageService'
// 导出核心类型
export * from './types'
