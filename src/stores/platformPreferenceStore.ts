import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { useAuthStore } from '@/stores/authStore'

/**
 * 平台偏好设置数据结构
 */
export interface PlatformPreference {
  /** 默认平台标识符 */
  defaultPlatform: string
  /** 最后更新时间 */
  updatedAt: string
}

/**
 * 账号-平台偏好映射结构
 * key: 账号ID
 * value: 该账号的平台偏好设置
 */
export interface AccountPlatformPreferences {
  [accountId: string]: PlatformPreference
}

/**
 * 平台偏好设置 Store 接口
 */
interface PlatformPreferenceStore {
  /** 所有账号的平台偏好映射 */
  preferences: AccountPlatformPreferences
  /** 系统默认平台（当账号没有设置偏好时使用） */
  systemDefaultPlatform: string
  /** 当前用户ID */
  currentUserId: string | null

  /**
   * 获取指定账号的默认平台
   * @param accountId 账号ID
   * @returns 平台标识符，如果未设置则返回系统默认平台
   */
  getDefaultPlatform: (accountId: string) => string

  /**
   * 设置指定账号的默认平台
   * @param accountId 账号ID
   * @param platform 平台标识符
   */
  setDefaultPlatform: (accountId: string, platform: string) => void

  /**
   * 获取指定账号的完整偏好设置
   * @param accountId 账号ID
   * @returns 平台偏好设置对象，如果不存在返回 null
   */
  getPreference: (accountId: string) => PlatformPreference | null

  /**
   * 删除指定账号的偏好设置
   * @param accountId 账号ID
   */
  removePreference: (accountId: string) => void

  /**
   * 检查指定账号是否有偏好设置
   * @param accountId 账号ID
   * @returns 是否存在偏好设置
   */
  hasPreference: (accountId: string) => boolean

  /**
   * 设置系统默认平台
   * @param platform 平台标识符
   */
  setSystemDefaultPlatform: (platform: string) => void

  /**
   * 清空所有偏好设置
   */
  clearAllPreferences: () => void

  /**
   * 导出所有偏好设置（用于备份）
   * @returns 偏好设置数据JSON字符串
   */
  exportPreferences: () => string

  /**
   * 导入偏好设置（用于恢复）
   * @param data JSON字符串
   * @returns 是否导入成功
   */
  importPreferences: (data: string) => boolean

  /**
   * 加载用户偏好数据
   * @param userId 用户ID
   */
  loadUserPreferences: (userId: string) => void

  /**
   * 重置状态（不清除持久化数据）
   */
  reset: () => void
}

/** 系统默认平台 */
const DEFAULT_SYSTEM_PLATFORM = 'buyin' // 默认平台：巨量百应

// 调试日志开关
const metaEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env
const DEBUG = metaEnv?.DEV === true

// 生成用户隔离的存储键
const getStorageKey = (userId: string | null) => {
  if (!userId) return 'platform-pref-guest'
  return `platform-pref-${userId}`
}

/**
 * 平台偏好设置 Store
 * 使用 zustand + immer + persist 实现持久化存储
 * 【修复】添加 userId 隔离，每个用户独立存储
 */
export const usePlatformPreferenceStore = create<PlatformPreferenceStore>()(
  persist(
    immer((set, get) => ({
      // 初始状态
      preferences: {},
      systemDefaultPlatform: DEFAULT_SYSTEM_PLATFORM,
      currentUserId: null,

      /**
       * 获取指定账号的默认平台
       */
      getDefaultPlatform: (accountId: string): string => {
        if (!accountId) {
          console.warn('[PlatformPreferenceStore] 获取默认平台失败：账号ID为空')
          return get().systemDefaultPlatform
        }

        try {
          const preference = get().preferences[accountId]
          if (preference?.defaultPlatform) {
            if (DEBUG) {
              console.log(
                `[PlatformPreferenceStore] 账号 ${accountId} 的默认平台:`,
                preference.defaultPlatform,
              )
            }
            return preference.defaultPlatform
          }
          if (DEBUG) {
            console.log(
              `[PlatformPreferenceStore] 账号 ${accountId} 未设置默认平台，使用系统默认:`,
              get().systemDefaultPlatform,
            )
          }
          return get().systemDefaultPlatform
        } catch (error) {
          console.error('[PlatformPreferenceStore] 获取默认平台失败:', error)
          return get().systemDefaultPlatform
        }
      },

      /**
       * 设置指定账号的默认平台
       */
      setDefaultPlatform: (accountId: string, platform: string): void => {
        if (!accountId) {
          console.warn('[PlatformPreferenceStore] 设置默认平台失败：账号ID为空')
          return
        }

        if (!platform) {
          console.warn('[PlatformPreferenceStore] 设置默认平台失败：平台标识符为空')
          return
        }

        try {
          set(state => {
            state.preferences[accountId] = {
              defaultPlatform: platform,
              updatedAt: new Date().toISOString(),
            }
          })
          if (DEBUG) {
            console.log(`[PlatformPreferenceStore] 账号 ${accountId} 的默认平台已设置为:`, platform)
          }
        } catch (error) {
          console.error('[PlatformPreferenceStore] 保存默认平台失败:', error)
          throw error
        }
      },

      /**
       * 获取指定账号的完整偏好设置
       */
      getPreference: (accountId: string): PlatformPreference | null => {
        if (!accountId) return null
        return get().preferences[accountId] || null
      },

      /**
       * 删除指定账号的偏好设置
       */
      removePreference: (accountId: string): void => {
        if (!accountId) return

        try {
          set(state => {
            delete state.preferences[accountId]
          })
          if (DEBUG) {
            console.log(`[PlatformPreferenceStore] 账号 ${accountId} 的偏好设置已删除`)
          }
        } catch (error) {
          console.error('[PlatformPreferenceStore] 删除偏好设置失败:', error)
        }
      },

      /**
       * 检查指定账号是否有偏好设置
       */
      hasPreference: (accountId: string): boolean => {
        if (!accountId) return false
        return !!get().preferences[accountId]?.defaultPlatform
      },

      /**
       * 设置系统默认平台
       */
      setSystemDefaultPlatform: (platform: string): void => {
        if (!platform) {
          console.warn('[PlatformPreferenceStore] 系统默认平台不能为空')
          return
        }

        try {
          set(state => {
            state.systemDefaultPlatform = platform
          })
          if (DEBUG) {
            console.log('[PlatformPreferenceStore] 系统默认平台已设置为:', platform)
          }
        } catch (error) {
          console.error('[PlatformPreferenceStore] 设置系统默认平台失败:', error)
        }
      },

      /**
       * 清空所有偏好设置
       */
      clearAllPreferences: (): void => {
        try {
          set(state => {
            state.preferences = {}
          })
          if (DEBUG) {
            console.log('[PlatformPreferenceStore] 所有偏好设置已清空')
          }
        } catch (error) {
          console.error('[PlatformPreferenceStore] 清空偏好设置失败:', error)
        }
      },

      /**
       * 导出所有偏好设置
       */
      exportPreferences: (): string => {
        try {
          const data = {
            preferences: get().preferences,
            systemDefaultPlatform: get().systemDefaultPlatform,
            exportedAt: new Date().toISOString(),
            version: '1.0',
          }
          return JSON.stringify(data, null, 2)
        } catch (error) {
          console.error('[PlatformPreferenceStore] 导出偏好设置失败:', error)
          return '{}'
        }
      },

      /**
       * 导入偏好设置
       */
      importPreferences: (data: string): boolean => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed.preferences || typeof parsed.preferences !== 'object') {
            console.error('[PlatformPreferenceStore] 导入失败：数据格式无效')
            return false
          }

          set(state => {
            state.preferences = { ...state.preferences, ...parsed.preferences }
            if (parsed.systemDefaultPlatform) {
              state.systemDefaultPlatform = parsed.systemDefaultPlatform
            }
          })
          if (DEBUG) {
            console.log('[PlatformPreferenceStore] 偏好设置导入成功')
          }
          return true
        } catch (error) {
          console.error('[PlatformPreferenceStore] 导入偏好设置失败:', error)
          return false
        }
      },

      /**
       * 加载用户偏好数据
       */
      loadUserPreferences: (userId: string) => {
        set(state => {
          if (state.currentUserId !== userId) {
            if (DEBUG) {
              console.log('[PlatformPreferenceStore] 用户切换:', state.currentUserId, '->', userId)
            }

            // 从 localStorage 加载新用户的数据
            const storageKey = getStorageKey(userId)
            try {
              const savedData = localStorage.getItem(storageKey)
              if (savedData) {
                const parsed = JSON.parse(savedData)
                if (parsed.state) {
                  state.preferences = parsed.state.preferences || {}
                  state.systemDefaultPlatform =
                    parsed.state.systemDefaultPlatform || DEFAULT_SYSTEM_PLATFORM
                  if (DEBUG) {
                    console.log('[PlatformPreferenceStore] 加载用户数据成功:', userId)
                  }
                }
              } else {
                // 首发版：新用户，初始化为空
                state.preferences = {}
                state.systemDefaultPlatform = DEFAULT_SYSTEM_PLATFORM
                if (DEBUG) {
                  console.log('[PlatformPreferenceStore] 新用户，初始化为空:', userId)
                }
              }
            } catch (e) {
              console.error('[PlatformPreferenceStore] 加载用户数据失败:', e)
              state.preferences = {}
              state.systemDefaultPlatform = DEFAULT_SYSTEM_PLATFORM
            }
          }
          state.currentUserId = userId
        })
      },

      /**
       * 重置状态（不清除持久化数据）
       */
      reset: () => {
        set(state => {
          state.preferences = {}
          state.systemDefaultPlatform = DEFAULT_SYSTEM_PLATFORM
          state.currentUserId = null
          if (DEBUG) {
            console.log('[PlatformPreferenceStore] 内存状态已重置（持久化数据保留）')
          }
        })
      },
    })),
    {
      name: 'platform-pref-dynamic',
      version: 1,
      // 【修复】使用 skipHydration 避免初始加载时 user 为 null 的问题
      skipHydration: true,
      // 使用自定义存储，根据 currentUserId 动态选择存储键
      storage: createJSONStorage(() => ({
        getItem: (_name: string) => {
          const userId = useAuthStore.getState().user?.id
          // 【Guest策略】未登录时，不读取持久化数据
          if (!userId) {
            if (DEBUG) console.log('[PlatformPref Storage] 未登录，跳过读取')
            return null
          }
          const key = getStorageKey(userId)
          const value = localStorage.getItem(key)
          if (DEBUG) {
            console.log('[PlatformPref Storage] 读取:', key, value ? '有数据' : '无数据')
          }
          return value
        },
        setItem: (_name: string, value: string) => {
          const userId = useAuthStore.getState().user?.id
          // 【Guest策略】未登录时，不保存到 localStorage
          if (!userId) {
            if (DEBUG) console.log('[PlatformPref Storage] 未登录，跳过保存')
            return
          }
          const key = getStorageKey(userId)
          localStorage.setItem(key, value)
          if (DEBUG) {
            console.log('[PlatformPref Storage] 保存:', key, '大小:', value.length)
          }
        },
        removeItem: (_name: string) => {
          const userId = useAuthStore.getState().user?.id
          if (!userId) {
            if (DEBUG) console.log('[PlatformPref Storage] 未登录，跳过删除')
            return
          }
          const key = getStorageKey(userId)
          localStorage.removeItem(key)
          if (DEBUG) {
            console.log('[PlatformPref Storage] 删除:', key)
          }
        },
      })),
      // 只持久化数据字段
      partialize: state => ({
        preferences: state.preferences,
        systemDefaultPlatform: state.systemDefaultPlatform,
        currentUserId: state.currentUserId,
      }),
    },
  ),
)
