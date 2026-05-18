import { useEffect } from 'react'
import { useAIChatStore } from '@/hooks/useAIChat'
import { useAppIpcBootstrap } from '@/hooks/useAppIpcBootstrap'
import { useLoadAutoMessageOnLogin } from '@/hooks/useAutoMessage'
import { useLoadAutoPopUpOnLogin } from '@/hooks/useAutoPopUp'
import { useLoadAutoReplyConfigOnLogin } from '@/hooks/useAutoReplyConfig'
import { useAutoStartOnLive } from '@/hooks/useAutoStartOnLive'
import { useLoadChromeConfigOnLogin } from '@/hooks/useChromeConfig'
import { useLoadLiveControlOnLogin } from '@/hooks/useLiveControl'
import { useLoadSubAccountOnLogin } from '@/hooks/useSubAccount'
import { useTaskConnectionGuard } from '@/hooks/useTaskConnectionGuard'
import { useTaskRecovery } from '@/hooks/useTaskRecovery'
import { useTaskRuntimeSync } from '@/hooks/useTaskRuntimeSync'
import { initializePlatformPreferenceService } from '@/services/platformPreferenceService'
import { ensureAccountsAuthSync } from '@/stores/auth/accountsAuthSync'

function scheduleIdleTask(task: () => void, timeout = 1000) {
  const idleWindow = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
    cancelIdleCallback?: (handle: number) => void
  }

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(() => task(), { timeout })
    return () => idleWindow.cancelIdleCallback?.(id)
  }

  const id = globalThis.setTimeout(task, 0)
  return () => globalThis.clearTimeout(id)
}

export default function AppRuntimeBoot() {
  const hydrateApiKeys = useAIChatStore(state => state.hydrateApiKeys)

  useAppIpcBootstrap()
  useAutoStartOnLive()
  useLoadChromeConfigOnLogin()
  useLoadAutoReplyConfigOnLogin()
  useLoadAutoPopUpOnLogin()
  useLoadAutoMessageOnLogin()
  useLoadSubAccountOnLogin()
  useLoadLiveControlOnLogin()
  useTaskConnectionGuard()
  useTaskRuntimeSync()
  useTaskRecovery()

  useEffect(() => ensureAccountsAuthSync(), [])

  useEffect(() => {
    return scheduleIdleTask(() => {
      initializePlatformPreferenceService()
    })
  }, [])

  useEffect(() => {
    return scheduleIdleTask(() => {
      void hydrateApiKeys()
    })
  }, [hydrateApiKeys])

  return null
}
