import { normalizeAccountSelection, useAccounts } from '@/hooks/useAccounts'
import type { AutoMessageConfig } from '@/hooks/useAutoMessage'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import type { AutoPopUpConfig, ShortcutMapping } from '@/hooks/useAutoPopUp'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import type { AutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { getUserConfig, syncUserConfig, type UserConfigData } from '@/services/apiClient'
import { usePlatformPreferenceStore } from '@/stores/platformPreferenceStore'

const metaEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env
const DEBUG = metaEnv?.DEV === true

type AccountScopedConfigMap<T> = Record<string, T>

interface CloudAutoReplyContext {
  config: AutoReplyConfig
}

interface CloudAutoMessageContext {
  config: AutoMessageConfig
}

interface CloudAutoPopUpContext {
  config: AutoPopUpConfig
  shortcuts?: ShortcutMapping[]
  isGlobalShortcut?: boolean
}

function filterAccountScopedConfig<T>(
  configMap: AccountScopedConfigMap<T> | undefined,
  allowedAccountIds: Set<string>,
): AccountScopedConfigMap<T> {
  if (!configMap) return {}

  return Object.fromEntries(
    Object.entries(configMap).filter(([accountId]) => allowedAccountIds.has(accountId)),
  )
}

function collectAutoReplyConfigs(): AccountScopedConfigMap<CloudAutoReplyContext> {
  const { contexts } = useAutoReplyConfigStore.getState()

  return Object.fromEntries(
    Object.entries(contexts)
      .filter(([, context]) => !!context?.config)
      .map(([accountId, context]) => [accountId, { config: context.config }]),
  )
}

function collectAutoMessageConfigs(): AccountScopedConfigMap<CloudAutoMessageContext> {
  const { contexts } = useAutoMessageStore.getState()

  return Object.fromEntries(
    Object.entries(contexts)
      .filter(([, context]) => !!context?.config)
      .map(([accountId, context]) => [accountId, { config: context.config }]),
  )
}

function collectAutoPopUpConfigs(): AccountScopedConfigMap<CloudAutoPopUpContext> {
  const { contexts } = useAutoPopUpStore.getState()

  return Object.fromEntries(
    Object.entries(contexts)
      .filter(([, context]) => !!context?.config)
      .map(([accountId, context]) => [
        accountId,
        {
          config: context.config,
          shortcuts: context.shortcuts,
          isGlobalShortcut: context.isGlobalShortcut,
        },
      ]),
  )
}

class ConfigSyncService {
  private syncTimeout: ReturnType<typeof setTimeout> | null = null
  private isSyncing = false
  private lastSyncTime = 0
  private lastQueuedSignature: string | null = null
  private lastSyncedSignature: string | null = null
  private readonly SYNC_DEBOUNCE_MS = 4000
  private readonly MIN_SYNC_INTERVAL_MS = 15000

  private enqueueSync(delayMs: number): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
    }

    this.syncTimeout = setTimeout(() => {
      this.syncTimeout = null
      this.syncToCloud().catch(err => {
        console.error('[ConfigSync] Scheduled sync failed:', err)
      })
    }, delayMs)
  }

  private getConfigSignature(config: UserConfigData): string {
    return JSON.stringify(config)
  }

  collectConfigData(): UserConfigData {
    const accountsState = useAccounts.getState()
    const platformPrefState = usePlatformPreferenceStore.getState()

    const config: UserConfigData = {
      accounts: accountsState.accounts,
      currentAccountId: accountsState.currentAccountId || undefined,
      defaultAccountId: null,
      platformPreferences: platformPrefState.preferences,
      autoReplyConfigs: collectAutoReplyConfigs(),
      autoMessageConfigs: collectAutoMessageConfigs(),
      autoPopUpConfigs: collectAutoPopUpConfigs(),
    }

    if (DEBUG) {
      console.log('[ConfigSync] Collected config data:', {
        accountsCount: config.accounts?.length || 0,
        hasPlatformPrefs: !!config.platformPreferences,
      })
    }

    return config
  }

  async syncToCloud(): Promise<{ success: boolean; error?: string }> {
    if (this.isSyncing) {
      if (DEBUG) console.log('[ConfigSync] Sync already in progress, skipping')
      this.enqueueSync(this.SYNC_DEBOUNCE_MS)
      return { success: true }
    }

    const now = Date.now()
    if (now - this.lastSyncTime < this.MIN_SYNC_INTERVAL_MS) {
      const retryDelay = this.MIN_SYNC_INTERVAL_MS - (now - this.lastSyncTime)
      if (DEBUG) console.log('[ConfigSync] Sync too frequent, rescheduling', { retryDelay })
      this.enqueueSync(retryDelay)
      return { success: true }
    }

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }

    this.isSyncing = true
    this.lastSyncTime = now

    try {
      const config = this.collectConfigData()
      const signature = this.getConfigSignature(config)

      const result = await syncUserConfig(config)

      if (result.ok && result.data?.success) {
        this.lastSyncedSignature = signature
        this.lastQueuedSignature = null
        if (DEBUG) console.log('[ConfigSync] Sync to cloud successful')
        return { success: true }
      }

      const errorMsg = result.ok ? result.data?.message : result.error?.message
      this.lastQueuedSignature = null
      console.error('[ConfigSync] Sync failed:', errorMsg)
      return { success: false, error: errorMsg }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      this.lastQueuedSignature = null
      console.error('[ConfigSync] Sync error:', errorMsg)
      return { success: false, error: errorMsg }
    } finally {
      this.isSyncing = false
    }
  }

  async loadFromCloud(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await getUserConfig()

      if (!result.ok) {
        const errorMsg = result.error?.message || 'Failed to fetch config'
        console.error('[ConfigSync] Load from cloud failed:', errorMsg)
        return { success: false, error: errorMsg }
      }

      const { config } = result.data

      if (!config) {
        if (DEBUG) console.log('[ConfigSync] No cloud config found, using local')
        return { success: true }
      }

      this.applyConfig(config)
      this.lastSyncedSignature = this.getConfigSignature(config)
      this.lastQueuedSignature = null

      if (DEBUG) {
        console.log('[ConfigSync] Load from cloud successful:', {
          accountsCount: config.accounts?.length || 0,
          hasPlatformPrefs: !!config.platformPreferences,
        })
      }

      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error('[ConfigSync] Load error:', errorMsg)
      return { success: false, error: errorMsg }
    }
  }

  private applyConfig(config: UserConfigData): void {
    const allowedAccountIds = new Set(
      (config.accounts ?? useAccounts.getState().accounts).map(account => account.id),
    )

    if (config.accounts && config.accounts.length > 0) {
      const currentUserId = useAccounts.getState().currentUserId
      if (currentUserId) {
        const normalized = normalizeAccountSelection(
          config.accounts,
          config.currentAccountId || '',
          null,
        )
        useAccounts.setState({
          accounts: config.accounts,
          currentAccountId: normalized.currentAccountId,
          defaultAccountId: null,
        })
        if (DEBUG) console.log('[ConfigSync] Applied accounts:', config.accounts.length)
      }
    }

    if (config.platformPreferences && Object.keys(config.platformPreferences).length > 0) {
      usePlatformPreferenceStore.setState({
        preferences: config.platformPreferences,
      })
      if (DEBUG) console.log('[ConfigSync] Applied platform preferences')
    }

    if (config.autoReplyConfigs) {
      const currentUserId = useAutoReplyConfigStore.getState().currentUserId
      const filteredContexts = filterAccountScopedConfig(
        config.autoReplyConfigs as AccountScopedConfigMap<CloudAutoReplyContext>,
        allowedAccountIds,
      )

      useAutoReplyConfigStore.setState({
        currentUserId,
        contexts: Object.fromEntries(
          Object.entries(filteredContexts).map(([accountId, context]) => [
            accountId,
            { config: context.config },
          ]),
        ),
      })

      if (DEBUG) console.log('[ConfigSync] Applied auto reply configs')
    }

    if (config.autoMessageConfigs) {
      const currentState = useAutoMessageStore.getState()
      const filteredContexts = filterAccountScopedConfig(
        config.autoMessageConfigs as AccountScopedConfigMap<CloudAutoMessageContext>,
        allowedAccountIds,
      )

      useAutoMessageStore.setState({
        currentUserId: currentState.currentUserId,
        contexts: Object.fromEntries(
          Object.entries(filteredContexts).map(([accountId, context]) => [
            accountId,
            {
              config: context.config,
              isRunning: currentState.contexts[accountId]?.isRunning ?? false,
              batchCount: currentState.contexts[accountId]?.batchCount,
            },
          ]),
        ),
      })

      if (DEBUG) console.log('[ConfigSync] Applied auto message configs')
    }

    if (config.autoPopUpConfigs) {
      const currentState = useAutoPopUpStore.getState()
      const filteredContexts = filterAccountScopedConfig(
        config.autoPopUpConfigs as AccountScopedConfigMap<CloudAutoPopUpContext>,
        allowedAccountIds,
      )

      useAutoPopUpStore.setState({
        currentUserId: currentState.currentUserId,
        contexts: Object.fromEntries(
          Object.entries(filteredContexts).map(([accountId, context]) => [
            accountId,
            {
              config: context.config,
              shortcuts: context.shortcuts ?? [],
              isGlobalShortcut: context.isGlobalShortcut,
              isRunning: currentState.contexts[accountId]?.isRunning ?? false,
            },
          ]),
        ),
      })

      if (DEBUG) console.log('[ConfigSync] Applied auto popup configs')
    }
  }

  scheduleSync(): void {
    const signature = this.getConfigSignature(this.collectConfigData())
    if (signature === this.lastQueuedSignature || signature === this.lastSyncedSignature) {
      return
    }

    this.lastQueuedSignature = signature
    this.enqueueSync(this.SYNC_DEBOUNCE_MS)
  }

  resetForTests(): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout)
      this.syncTimeout = null
    }
    this.isSyncing = false
    this.lastSyncTime = 0
    this.lastQueuedSignature = null
    this.lastSyncedSignature = null
  }

  setupAutoSync(): () => void {
    const unsubscribers: Array<() => void> = []

    const accountsUnsubscribe = useAccounts.subscribe((state, prevState) => {
      if (
        state.accounts !== prevState.accounts ||
        state.currentAccountId !== prevState.currentAccountId ||
        state.defaultAccountId !== prevState.defaultAccountId
      ) {
        this.scheduleSync()
      }
    })
    unsubscribers.push(accountsUnsubscribe)

    const platformPrefUnsubscribe = usePlatformPreferenceStore.subscribe((state, prevState) => {
      if (state.preferences !== prevState.preferences) {
        this.scheduleSync()
      }
    })
    unsubscribers.push(platformPrefUnsubscribe)

    const autoReplyUnsubscribe = useAutoReplyConfigStore.subscribe((state, prevState) => {
      if (state.contexts !== prevState.contexts) {
        this.scheduleSync()
      }
    })
    unsubscribers.push(autoReplyUnsubscribe)

    const autoMessageUnsubscribe = useAutoMessageStore.subscribe((state, prevState) => {
      if (state.contexts !== prevState.contexts) {
        this.scheduleSync()
      }
    })
    unsubscribers.push(autoMessageUnsubscribe)

    const autoPopUpUnsubscribe = useAutoPopUpStore.subscribe((state, prevState) => {
      if (state.contexts !== prevState.contexts) {
        this.scheduleSync()
      }
    })
    unsubscribers.push(autoPopUpUnsubscribe)

    if (DEBUG) console.log('[ConfigSync] Auto-sync setup complete')

    return () => {
      unsubscribers.forEach(unsub => unsub())
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout)
      }
    }
  }
}

export const configSyncService = new ConfigSyncService()
