import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef } from 'react'
import { SUB_ACCOUNT_STORAGE_KEY, SUB_ACCOUNT_WORKSPACE_ID } from 'shared/subAccountWorkspace'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_PRESET_CATEGORIES } from '@/pages/SubAccount/constants'

export interface SubAccountMessage {
  id: string
  content: string
  weight: number
}

export interface SubAccountStats {
  totalSent: number
  successCount: number
  failCount: number
  lastSendTime?: number
  lastError?: string
}

export interface SubAccount {
  id: string
  name: string
  platform: LiveControlPlatform
  status: 'idle' | 'connecting' | 'connected' | 'error'
  error?: string
  stats: SubAccountStats
  group?: string
  hasStorageState?: boolean
  liveRoomUrl?: string
  liveRoomStatus?: 'idle' | 'entering' | 'entered' | 'error'
  lastEnterError?: string
}

export interface SubAccountGroup {
  id: string
  name: string
  accountIds: string[]
  enabled: boolean
}

export interface SubAccountPresetCategory {
  id: string
  name: string
  description: string
  messages: SubAccountMessage[]
}

interface SubAccountInteractionConfig {
  scheduler: {
    interval: [number, number]
  }
  messages: SubAccountMessage[]
  random: boolean
  extraSpaces: boolean
  rotateAccounts: boolean
  rotateGroups: boolean
  groups: SubAccountGroup[]
}

interface SubAccountContext {
  isRunning: boolean
  config: SubAccountInteractionConfig
  accounts: SubAccount[]
  batchCount: number
  liveRoomUrl: string
  presetCategories: SubAccountPresetCategory[]
}

function createDefaultPresetCategories(): SubAccountPresetCategory[] {
  return DEFAULT_PRESET_CATEGORIES.map(category => ({
    id: category.id,
    name: category.name,
    description: category.description,
    messages: category.messages.map(message => ({
      id: message.id,
      content: message.content,
      weight: message.weight,
    })),
  }))
}

const defaultContext = (): SubAccountContext => ({
  isRunning: false,
  config: {
    scheduler: {
      interval: [30000, 60000],
    },
    messages: [
      { id: '1', content: '666', weight: 1 },
      { id: '2', content: '支持主播', weight: 1 },
      { id: '3', content: '来了来了', weight: 1 },
    ],
    random: true,
    extraSpaces: true,
    rotateAccounts: true,
    rotateGroups: false,
    groups: [],
  },
  accounts: [],
  batchCount: 5,
  liveRoomUrl: '',
  presetCategories: createDefaultPresetCategories(),
})

interface SubAccountStore {
  contexts: Record<string, SubAccountContext>
  currentUserId: string | null
  setIsRunning: (accountId: string, running: boolean) => void
  setConfig: (accountId: string, config: Partial<SubAccountInteractionConfig>) => void
  setAccounts: (accountId: string, accounts: SubAccount[]) => void
  addAccount: (accountId: string, account: SubAccount) => void
  removeAccount: (accountId: string, subAccountId: string) => void
  updateAccountStatus: (
    accountId: string,
    subAccountId: string,
    status: SubAccount['status'],
    error?: string,
  ) => void
  updateAccountStats: (
    accountId: string,
    subAccountId: string,
    stats: Partial<SubAccountStats>,
  ) => void
  setBatchCount: (accountId: string, batchCount: number) => void
  setLiveRoomUrl: (accountId: string, url: string) => void
  addGroup: (accountId: string, group: SubAccountGroup) => void
  removeGroup: (accountId: string, groupId: string) => void
  updateGroup: (accountId: string, groupId: string, updates: Partial<SubAccountGroup>) => void
  setAccountGroup: (accountId: string, subAccountId: string, groupId: string | undefined) => void
  setPresetCategories: (accountId: string, categories: SubAccountPresetCategory[]) => void
  loadUserContexts: (_userId: string) => void
  resetAllContexts: () => void
}

function createPersistedSnapshot(context: SubAccountContext): SubAccountContext {
  return {
    ...context,
    isRunning: false,
    accounts: context.accounts.map(account => ({
      ...account,
      status: 'idle' as const,
      error: undefined,
      liveRoomUrl: undefined,
      liveRoomStatus: 'idle' as const,
      lastEnterError: undefined,
    })),
  }
}

function loadPersistedContext(): SubAccountContext {
  if (typeof window === 'undefined') {
    return defaultContext()
  }

  try {
    const raw = window.localStorage.getItem(SUB_ACCOUNT_STORAGE_KEY)
    if (!raw) {
      return defaultContext()
    }

    const parsed = JSON.parse(raw) as Partial<SubAccountContext>
    return {
      ...defaultContext(),
      ...parsed,
      isRunning: false,
      config: {
        ...defaultContext().config,
        ...parsed.config,
        scheduler: parsed.config?.scheduler ?? defaultContext().config.scheduler,
        messages:
          parsed.config?.messages && parsed.config.messages.length > 0
            ? parsed.config.messages
            : defaultContext().config.messages,
        groups: parsed.config?.groups ?? defaultContext().config.groups,
      },
      presetCategories:
        parsed.presetCategories && parsed.presetCategories.length > 0
          ? parsed.presetCategories.map(category => ({
              ...category,
              messages:
                category.messages?.map(message => ({
                  id: message.id || crypto.randomUUID(),
                  content: message.content,
                  weight: message.weight || 1,
                })) ?? [],
            }))
          : createDefaultPresetCategories(),
      accounts: (parsed.accounts ?? []).map(account => ({
        ...account,
        status: 'idle' as const,
        error: undefined,
        liveRoomUrl: undefined,
        liveRoomStatus: 'idle' as const,
        lastEnterError: undefined,
        stats: account.stats || { totalSent: 0, successCount: 0, failCount: 0 },
      })),
    }
  } catch (error) {
    console.error('[SubAccount] 读取独立工作区配置失败:', error)
    return defaultContext()
  }
}

function persistContext(context: SubAccountContext) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      SUB_ACCOUNT_STORAGE_KEY,
      JSON.stringify(createPersistedSnapshot(context)),
    )
  } catch (error) {
    console.error('[SubAccount] 保存独立工作区配置失败:', error)
  }
}

function resolveWorkspaceId(_accountId?: string) {
  return SUB_ACCOUNT_WORKSPACE_ID
}

export const useSubAccountStore = create<SubAccountStore>()(
  immer(set => {
    const ensureContext = (state: SubAccountStore) => {
      const workspaceId = resolveWorkspaceId()
      if (!state.contexts[workspaceId]) {
        state.contexts[workspaceId] = loadPersistedContext()
      }
      return state.contexts[workspaceId]
    }

    return {
      contexts: {
        [SUB_ACCOUNT_WORKSPACE_ID]: loadPersistedContext(),
      },
      currentUserId: null,

      setIsRunning: (_accountId, running) =>
        set(state => {
          const context = ensureContext(state)
          context.isRunning = running
        }),

      setConfig: (_accountId, config) =>
        set(state => {
          const context = ensureContext(state)
          context.config = {
            ...context.config,
            ...config,
          }
          persistContext(context)
        }),

      setAccounts: (_accountId, accounts) =>
        set(state => {
          const context = ensureContext(state)
          context.accounts = accounts
          persistContext(context)
        }),

      addAccount: (_accountId, account) =>
        set(state => {
          const context = ensureContext(state)
          context.accounts.push(account)
          persistContext(context)
        }),

      removeAccount: (_accountId, subAccountId) =>
        set(state => {
          const context = ensureContext(state)
          context.accounts = context.accounts.filter(account => account.id !== subAccountId)
          persistContext(context)
        }),

      updateAccountStatus: (_accountId, subAccountId, status, error) =>
        set(state => {
          const context = ensureContext(state)
          const account = context.accounts.find(item => item.id === subAccountId)
          if (account) {
            account.status = status
            account.error = error
          }
        }),

      updateAccountStats: (_accountId, subAccountId, stats) =>
        set(state => {
          const context = ensureContext(state)
          const account = context.accounts.find(item => item.id === subAccountId)
          if (account) {
            account.stats = { ...account.stats, ...stats }
          }
        }),

      setBatchCount: (_accountId, batchCount) =>
        set(state => {
          const context = ensureContext(state)
          context.batchCount = batchCount
          persistContext(context)
        }),

      setLiveRoomUrl: (_accountId, url) =>
        set(state => {
          const context = ensureContext(state)
          context.liveRoomUrl = url
          persistContext(context)
        }),

      addGroup: (_accountId, group) =>
        set(state => {
          const context = ensureContext(state)
          context.config.groups.push(group)
          persistContext(context)
        }),

      removeGroup: (_accountId, groupId) =>
        set(state => {
          const context = ensureContext(state)
          const removedGroup = context.config.groups.find(group => group.id === groupId)
          const affectedAccountIds = removedGroup?.accountIds ?? []
          context.config.groups = context.config.groups.filter(group => group.id !== groupId)
          context.accounts.forEach(account => {
            if (affectedAccountIds.includes(account.id)) {
              account.group = undefined
            }
          })
          persistContext(context)
        }),

      updateGroup: (_accountId, groupId, updates) =>
        set(state => {
          const context = ensureContext(state)
          const group = context.config.groups.find(item => item.id === groupId)
          if (group) {
            Object.assign(group, updates)
          }
          persistContext(context)
        }),

      setAccountGroup: (_accountId, subAccountId, groupId) =>
        set(state => {
          const context = ensureContext(state)
          const account = context.accounts.find(item => item.id === subAccountId)
          if (account) {
            context.config.groups.forEach(group => {
              group.accountIds = group.accountIds.filter(id => id !== subAccountId)
            })

            if (groupId) {
              const group = context.config.groups.find(item => item.id === groupId)
              if (group && !group.accountIds.includes(subAccountId)) {
                group.accountIds.push(subAccountId)
              }
              account.group = group?.name
            } else {
              account.group = undefined
            }
          }
          persistContext(context)
        }),

      setPresetCategories: (_accountId, categories) =>
        set(state => {
          const context = ensureContext(state)
          context.presetCategories = categories
          persistContext(context)
        }),

      loadUserContexts: () =>
        set(state => {
          state.contexts[SUB_ACCOUNT_WORKSPACE_ID] = loadPersistedContext()
        }),

      resetAllContexts: () =>
        set(state => {
          const context = ensureContext(state)
          persistContext(context)
        }),
    }
  }),
)

export const useSubAccountActions = () => {
  const updateConfig = useMemoizedFn((newConfig: Partial<SubAccountInteractionConfig>) => {
    useSubAccountStore.getState().setConfig(SUB_ACCOUNT_WORKSPACE_ID, newConfig)
  })

  return useMemo(() => {
    const getStore = () => useSubAccountStore.getState()
    return {
      setIsRunning: (running: boolean) =>
        getStore().setIsRunning(SUB_ACCOUNT_WORKSPACE_ID, running),
      setScheduler: (scheduler: SubAccountInteractionConfig['scheduler']) =>
        updateConfig({ scheduler }),
      setMessages: (messages: SubAccountMessage[]) => updateConfig({ messages }),
      setRandom: (random: boolean) => updateConfig({ random }),
      setExtraSpaces: (extraSpaces: boolean) => updateConfig({ extraSpaces }),
      setRotateAccounts: (rotateAccounts: boolean) => updateConfig({ rotateAccounts }),
      setAccounts: (accounts: SubAccount[]) =>
        getStore().setAccounts(SUB_ACCOUNT_WORKSPACE_ID, accounts),
      addAccount: (account: SubAccount) => getStore().addAccount(SUB_ACCOUNT_WORKSPACE_ID, account),
      removeAccount: (subAccountId: string) =>
        getStore().removeAccount(SUB_ACCOUNT_WORKSPACE_ID, subAccountId),
      updateAccountStatus: (subAccountId: string, status: SubAccount['status'], error?: string) =>
        getStore().updateAccountStatus(SUB_ACCOUNT_WORKSPACE_ID, subAccountId, status, error),
      updateAccountStats: (subAccountId: string, stats: Partial<SubAccountStats>) =>
        getStore().updateAccountStats(SUB_ACCOUNT_WORKSPACE_ID, subAccountId, stats),
      setBatchCount: (count: number) => getStore().setBatchCount(SUB_ACCOUNT_WORKSPACE_ID, count),
      setLiveRoomUrl: (url: string) => getStore().setLiveRoomUrl(SUB_ACCOUNT_WORKSPACE_ID, url),
      addGroup: (group: SubAccountGroup) => getStore().addGroup(SUB_ACCOUNT_WORKSPACE_ID, group),
      removeGroup: (groupId: string) => getStore().removeGroup(SUB_ACCOUNT_WORKSPACE_ID, groupId),
      updateGroup: (groupId: string, updates: Partial<SubAccountGroup>) =>
        getStore().updateGroup(SUB_ACCOUNT_WORKSPACE_ID, groupId, updates),
      setAccountGroup: (subAccountId: string, groupId: string | undefined) =>
        getStore().setAccountGroup(SUB_ACCOUNT_WORKSPACE_ID, subAccountId, groupId),
      setPresetCategories: (categories: SubAccountPresetCategory[]) =>
        getStore().setPresetCategories(SUB_ACCOUNT_WORKSPACE_ID, categories),
      setRotateGroups: (rotateGroups: boolean) => updateConfig({ rotateGroups }),
    }
  }, [updateConfig])
}

export const useCurrentSubAccount = <T>(getter: (context: SubAccountContext) => T): T => {
  const defaultContextRef = useRef(defaultContext())

  return useSubAccountStore(
    useShallow(state => {
      const context = state.contexts[SUB_ACCOUNT_WORKSPACE_ID] ?? defaultContextRef.current
      return getter(context)
    }),
  )
}

export function useLoadSubAccountOnLogin() {
  useEffect(() => {
    useSubAccountStore.getState().loadUserContexts('')
  }, [])
}

export function useSyncSubAccountsOnMount() {
  const accounts = useCurrentSubAccount(ctx => ctx.accounts)
  const syncSignature = JSON.stringify(
    accounts.map(account => ({
      id: account.id,
      name: account.name,
      platform: account.platform,
    })),
  )

  useEffect(() => {
    const configs = JSON.parse(syncSignature) as Array<{
      id: string
      name: string
      platform: LiveControlPlatform
    }>

    window.subAccountAPI
      .syncAccounts(SUB_ACCOUNT_WORKSPACE_ID, configs)
      .then(() => {
        console.log('[SubAccount] 独立工作区小号同步成功')
      })
      .catch(error => {
        console.error('[SubAccount] 独立工作区小号同步失败:', error)
      })
  }, [syncSignature])
}
