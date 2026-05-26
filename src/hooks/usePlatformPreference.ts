import { useCallback, useEffect, useRef } from 'react'
import { usePlatformPreferenceStore } from '@/stores/platformPreferenceStore'
import { useAccounts } from './useAccounts'
import { useCurrentLiveControl, useCurrentLiveControlActions } from './useLiveControl'

/**
 * Hook: 使用平台偏好设置
 *
 * 功能：
 * 1. 在账号切换时自动加载对应账号的平台偏好
 * 2. 提供保存平台偏好的方法
 * 3. 处理错误回退逻辑
 */
export function usePlatformPreference() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const { setPlatform } = useCurrentLiveControlActions()
  const getDefaultPlatform = usePlatformPreferenceStore(state => state.getDefaultPlatform)
  const setDefaultPlatform = usePlatformPreferenceStore(state => state.setDefaultPlatform)
  const hasPreference = usePlatformPreferenceStore(state => state.hasPreference)
  const systemDefaultPlatform = usePlatformPreferenceStore(state => state.systemDefaultPlatform)

  const isLoadingRef = useRef(false)

  /**
   * 加载当前账号的默认平台
   * @param autoApply 是否自动应用到当前平台选择器
   * @returns 平台标识符或 null
   */
  const loadDefaultPlatform = useCallback(
    (autoApply = false): string | null => {
      if (!currentAccountId) {
        console.warn('[usePlatformPreference] 无法加载默认平台：当前账号ID为空')
        return null
      }

      if (isLoadingRef.current) {
        console.log('[usePlatformPreference] 正在加载中，跳过重复请求')
        return null
      }

      try {
        isLoadingRef.current = true
        const platform = getDefaultPlatform(currentAccountId)

        console.log('[usePlatformPreference] 加载默认平台:', {
          accountId: currentAccountId,
          platform,
          hasPreference: hasPreference(currentAccountId),
        })

        if (autoApply && platform) {
          setPlatform(platform)
        }

        return platform
      } catch (error) {
        console.error('[usePlatformPreference] 加载默认平台失败:', error)
        // 出错时返回系统默认平台
        return systemDefaultPlatform
      } finally {
        isLoadingRef.current = false
      }
    },
    [currentAccountId, getDefaultPlatform, hasPreference, setPlatform, systemDefaultPlatform],
  )

  /**
   * 保存当前账号的默认平台
   * @param platform 平台标识符
   * @returns 是否保存成功
   */
  const saveDefaultPlatform = useCallback(
    (platform: string): boolean => {
      if (!currentAccountId) {
        console.warn('[usePlatformPreference] 无法保存默认平台：当前账号ID为空')
        return false
      }

      if (!platform) {
        console.warn('[usePlatformPreference] 无法保存默认平台：平台标识符为空')
        return false
      }

      try {
        setDefaultPlatform(currentAccountId, platform)
        console.log('[usePlatformPreference] 默认平台已保存:', {
          accountId: currentAccountId,
          platform,
        })
        return true
      } catch (error) {
        console.error('[usePlatformPreference] 保存默认平台失败:', error)
        return false
      }
    },
    [currentAccountId, setDefaultPlatform],
  )

  /**
   * 检查当前账号是否有平台偏好设置
   */
  const hasDefaultPlatform = useCallback((): boolean => {
    if (!currentAccountId) return false
    return hasPreference(currentAccountId)
  }, [currentAccountId, hasPreference])

  /**
   * 获取当前账号的默认平台（不自动应用）
   */
  const getCurrentDefaultPlatform = useCallback((): string => {
    if (!currentAccountId) return systemDefaultPlatform
    return getDefaultPlatform(currentAccountId)
  }, [currentAccountId, getDefaultPlatform, systemDefaultPlatform])

  return {
    /**
     * 加载当前账号的默认平台
     */
    loadDefaultPlatform,
    /**
     * 保存当前账号的默认平台
     */
    saveDefaultPlatform,
    /**
     * 检查当前账号是否有平台偏好设置
     */
    hasDefaultPlatform,
    /**
     * 获取当前账号的默认平台
     */
    getCurrentDefaultPlatform,
    /**
     * 当前账号ID
     */
    currentAccountId,
    /**
     * 系统默认平台
     */
    systemDefaultPlatform,
  }
}

/**
 * Hook: 自动加载平台偏好
 *
 * 在账号切换时自动加载对应账号的平台偏好设置
 */
export function useAutoLoadPlatformPreference() {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const boundPlatform = useAccounts(state => {
    const currentAccount = state.accounts.find(account => account.id === state.currentAccountId)
    return currentAccount?.platform ?? null
  })
  const { setPlatform } = useCurrentLiveControlActions()
  const getDefaultPlatform = usePlatformPreferenceStore(state => state.getDefaultPlatform)
  const systemDefaultPlatform = usePlatformPreferenceStore(state => state.systemDefaultPlatform)
  const connectState = useCurrentLiveControl(context => context.connectState)

  const lastAccountIdRef = useRef<string | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    // 没有当前账号时不处理
    if (!currentAccountId) {
      return
    }

    // 检查是否需要加载默认平台：
    // 1. 初始加载时
    // 2. 账号切换时
    const shouldLoadPlatform =
      isInitialLoadRef.current || currentAccountId !== lastAccountIdRef.current

    if (!shouldLoadPlatform) {
      return
    }

    console.log('[useAutoLoadPlatformPreference] 加载默认平台:', {
      isInitial: isInitialLoadRef.current,
      from: lastAccountIdRef.current,
      to: currentAccountId,
      currentPlatform: connectState.platform,
      boundPlatform,
    })

    try {
      if (boundPlatform) {
        if (connectState.platform !== boundPlatform) {
          console.log(
            '[useAutoLoadPlatformPreference] 当前账号已绑定平台，应用绑定平台:',
            boundPlatform,
          )
          setPlatform(boundPlatform)
        }
        isInitialLoadRef.current = false
        lastAccountIdRef.current = currentAccountId
        return
      }

      // 仅在当前未选择平台时应用默认/系统默认，避免覆盖用户已选或持久化的平台（如测试平台）
      if (connectState.platform) {
        console.log('[useAutoLoadPlatformPreference] 已有平台选择，保持:', connectState.platform)
        isInitialLoadRef.current = false
        lastAccountIdRef.current = currentAccountId
        return
      }

      const defaultPlatform = getDefaultPlatform(currentAccountId)
      const platformToApply = defaultPlatform || systemDefaultPlatform

      console.log('[useAutoLoadPlatformPreference] 应用默认平台:', platformToApply, {
        fromPreference: !!defaultPlatform,
      })
      setPlatform(platformToApply)
    } catch (error) {
      console.error('[useAutoLoadPlatformPreference] 加载平台偏好失败:', error)
      if (!connectState.platform) {
        setPlatform(systemDefaultPlatform)
      }
    }

    // 更新状态
    isInitialLoadRef.current = false
    lastAccountIdRef.current = currentAccountId
  }, [
    currentAccountId,
    boundPlatform,
    getDefaultPlatform,
    setPlatform,
    systemDefaultPlatform,
    connectState.platform,
  ])
}
