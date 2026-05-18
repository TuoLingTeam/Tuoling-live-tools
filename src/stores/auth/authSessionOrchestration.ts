import { AUTH_LAST_IDENTIFIER_KEY, AUTH_REMEMBER_ME_KEY } from '@/constants/authStorageKeys'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useChromeConfigStore } from '@/hooks/useChromeConfig'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useSubAccountStore } from '@/hooks/useSubAccount'
import { configSyncService } from '@/services/configSyncService'
import { usePlatformPreferenceStore } from '../platformPreferenceStore'
import { useTrialStore } from '../trialStore'

const USER_SCOPED_STORAGE_PREFIXES = [
  'account-config',
  'chrome-config',
  'auto-reply',
  'auto-reply-history',
  'auto-message',
  'auto-popup',
  'live-control',
  'task-recovery',
  'sub-account',
  'account-pref',
] as const

export function loadUserBaseSessionData(userId: string): void {
  useAccounts.getState().loadUserAccounts(userId)
  usePlatformPreferenceStore.getState().loadUserPreferences(userId)
}

export function loadUserScopedRuntimeContexts(userId: string): void {
  useAutoReplyStore.getState().loadUserContexts(userId)
  useAutoReplyConfigStore.getState().loadUserContexts(userId)
  useAutoMessageStore.getState().loadUserContexts(userId)
  useAutoPopUpStore.getState().loadUserContexts(userId)
  useChromeConfigStore.getState().loadUserConfigs(userId)
  useLiveControlStore.getState().loadUserContexts(userId)
  useSubAccountStore.getState().loadUserContexts(userId)
}

export async function syncConfigToCloudSafely(
  userId: string | null | undefined,
  successMessage: string,
  failureMessage: string,
): Promise<void> {
  if (!userId) {
    return
  }

  try {
    await configSyncService.syncToCloud()
    console.log(successMessage)
  } catch (error) {
    console.error(failureMessage, error)
  }
}

export function saveAccountsSnapshot(userId: string | null | undefined, logMessage: string): void {
  if (!userId) {
    return
  }

  console.log(logMessage, userId)
  const accountsState = useAccounts.getState()
  const storageKey = `accounts-storage-${userId}`
  const dataToSave = {
    state: {
      accounts: accountsState.accounts,
      currentAccountId: accountsState.currentAccountId,
      defaultAccountId: null,
    },
    version: 0,
  }
  localStorage.setItem(storageKey, JSON.stringify(dataToSave))
}

export function clearUserScopedBusinessStorage(userId: string | null | undefined): void {
  if (!userId) {
    return
  }

  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) {
      continue
    }

    if (USER_SCOPED_STORAGE_PREFIXES.some(prefix => key.startsWith(`${prefix}-${userId}`))) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }
}

export function resetUserScopedStores(): void {
  useTrialStore.getState().reset()
  useAccounts.getState().reset()
  useLiveControlStore.getState().resetAllContexts?.()
  useAutoMessageStore.getState().resetAllContexts?.()
  useAutoPopUpStore.getState().resetAllContexts?.()
  useAutoReplyStore.getState().resetAllContexts?.()
  useAutoReplyConfigStore.getState().resetAllContexts?.()
  useChromeConfigStore.getState().resetAllContexts()
  useSubAccountStore.getState().resetAllContexts?.()
}

export function clearRememberedIdentifierIfNeeded(): void {
  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(AUTH_REMEMBER_ME_KEY) !== 'true'
  ) {
    localStorage.removeItem(AUTH_LAST_IDENTIFIER_KEY)
    localStorage.setItem(AUTH_REMEMBER_ME_KEY, 'false')
  }
}
