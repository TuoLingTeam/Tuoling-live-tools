import { useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { abilities } from '@/abilities'
import { AUTO_REPLY } from '@/constants'
import { useAuthStore } from '@/stores/authStore'
import { useCommentListenerRuntimeStore } from '@/utils/commentListenerRuntime'
import { flushAllPersists, flushPersist, schedulePersist } from '@/utils/debouncedPersist'
import { EVENTS, eventEmitter } from '@/utils/events'
import type { StringFilterConfig } from '@/utils/filter'
import { mergeWithoutArray } from '@/utils/misc'
import { storageManager } from '@/utils/storage/StorageManager'
import type { EventMessageType } from './autoReplyTypes'
import { useAccounts } from './useAccounts'
import { useLiveControlStore } from './useLiveControl'

interface AutoReplyBaseConfig {
  entry: CommentListenerConfig['source']
  hideUsername: boolean
  comment: {
    keywordReply: {
      enable: boolean
      rules: {
        keywords: string[]
        contents: string[]
      }[]
    }
    aiReply: {
      enable: boolean
      prompt: string
      productPrompt?: string
      autoSend: boolean
      /** 【P1-1 AI联动】是否使用AI对话的共享配置 */
      useSharedConfig?: boolean
    }
  }
  blockList: string[]
  ws?: {
    enable: boolean
    port: number
  }
}

export type SimpleEventReplyMessage = string | { content: string; filter: StringFilterConfig }

export interface SimpleEventReply {
  enable: boolean
  messages: SimpleEventReplyMessage[]
  options?: Record<string, boolean>
}

type CompassExtraConfig = {
  [K in EventMessageType]: SimpleEventReply
}

type WechatChannelExtraConfig = {
  pinComment: {
    enable: boolean
    includeHost: boolean
    matchStr: string[]
  }
}

export type AutoReplyConfig = AutoReplyBaseConfig & CompassExtraConfig & WechatChannelExtraConfig

const ALL_LISTENING_SOURCES: AutoReplyConfig['entry'][] = [
  'compass',
  'control',
  'wechat-channel',
  'xiaohongshu',
  'taobao',
]

function normalizeUserPrompt(prompt?: string) {
  const normalized = prompt?.trim() ?? ''
  if (!normalized) {
    return AUTO_REPLY.DEFAULT_USER_PROMPT
  }
  if (normalized === AUTO_REPLY.LEGACY_USER_PROMPT.trim()) {
    return AUTO_REPLY.DEFAULT_USER_PROMPT
  }
  return normalized
}

function getDefaultEntryForPlatform(platform?: LiveControlPlatform): AutoReplyConfig['entry'] {
  switch (platform) {
    case 'douyin':
    case 'buyin':
    case 'eos':
      return 'compass'
    case 'wxchannel':
      return 'wechat-channel'
    case 'xiaohongshu':
    case 'pgy':
      return 'xiaohongshu'
    case 'taobao':
      return 'taobao'
    default:
      return 'control'
  }
}

function resolvePlatformForAccount(accountId: string): LiveControlPlatform | undefined {
  const accountPlatform = useAccounts
    .getState()
    .accounts.find(account => account.id === accountId)?.platform
  if (accountPlatform) {
    return accountPlatform
  }

  const liveControlPlatform =
    useLiveControlStore.getState().contexts[accountId]?.connectState.platform
  if (liveControlPlatform) {
    return liveControlPlatform as LiveControlPlatform
  }

  return undefined
}

function normalizeEntryForPlatform(
  entry: AutoReplyConfig['entry'] | string | null | undefined,
  platform?: LiveControlPlatform,
): AutoReplyConfig['entry'] {
  const normalizedEntry =
    typeof entry === 'string' && ALL_LISTENING_SOURCES.includes(entry as AutoReplyConfig['entry'])
      ? (entry as AutoReplyConfig['entry'])
      : undefined

  if (!platform) {
    return normalizedEntry ?? getDefaultEntryForPlatform(platform)
  }

  const supported = abilities[platform]?.autoReply?.source ?? []
  if (normalizedEntry && supported.includes(normalizedEntry)) {
    return normalizedEntry
  }
  return getDefaultEntryForPlatform(platform)
}

export function getSafeAutoReplyEntry(
  accountId: string,
  entry?: AutoReplyConfig['entry'] | string | null,
): AutoReplyConfig['entry'] {
  return normalizeEntryForPlatform(entry, resolvePlatformForAccount(accountId))
}

function normalizeConfigForPlatform(
  config: AutoReplyConfig,
  platform?: LiveControlPlatform,
): AutoReplyConfig {
  return {
    ...config,
    entry: normalizeEntryForPlatform(config.entry, platform),
  }
}

export const createDefaultConfig = (platform?: LiveControlPlatform): AutoReplyConfig => {
  return {
    entry: getDefaultEntryForPlatform(platform),
    hideUsername: false,
    comment: {
      keywordReply: {
        enable: false,
        rules: [],
      },
      aiReply: {
        enable: false,
        prompt: AUTO_REPLY.DEFAULT_USER_PROMPT,
        productPrompt: AUTO_REPLY.DEFAULT_USER_PROMPT,
        autoSend: false,
      },
    },
    room_enter: {
      enable: false,
      messages: [],
    },
    room_like: {
      enable: false,
      messages: [],
    },
    subscribe_merchant_brand_vip: {
      enable: false,
      messages: [],
    },
    live_order: {
      enable: false,
      messages: [],
      options: {
        onlyReplyPaid: false,
      },
    },
    room_follow: {
      enable: false,
      messages: [],
    },
    ecom_fansclub_participate: {
      enable: false,
      messages: [],
    },
    pinComment: {
      enable: false,
      includeHost: false,
      matchStr: [],
    },
    blockList: [],
    ws: {
      enable: false,
      port: 12354,
    },
  }
}

type DeepPartial<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? {
          [P in keyof T]?: DeepPartial<T[P]>
        }
      : T

interface AutoReplyContext {
  config: AutoReplyConfig
}

const defaultContext = (platform?: LiveControlPlatform): AutoReplyContext => ({
  config: createDefaultConfig(platform),
})

interface AutoReplyConfigStore {
  contexts: Record<string, AutoReplyContext>
  currentUserId: string | null
  updateConfig: (accountId: string, configUpdates: DeepPartial<AutoReplyConfig>) => void
  loadUserContexts: (userId: string) => void
  resetAllContexts: () => void
}

export const useAutoReplyConfigStore = create<AutoReplyConfigStore>()(
  immer((set, get) => {
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
        const { currentUserId } = get()
        if (currentUserId) {
          try {
            storageManager.remove('auto-reply', {
              level: 'account',
              userId: currentUserId,
              accountId,
            })
          } catch (e) {
            console.error('[AutoReplyConfig] 删除存储失败:', e)
          }
        }
      })
    })

    const ensureContext = (state: AutoReplyConfigStore, accountId: string) => {
      if (!state.contexts[accountId]) {
        const platform = useAccounts
          .getState()
          .accounts.find(account => account.id === accountId)?.platform
        state.contexts[accountId] = defaultContext(platform)
      }
      return state.contexts[accountId]
    }

    const saveToStorage = (
      accountId: string,
      context: AutoReplyContext,
      options?: { immediate?: boolean },
    ) => {
      const { currentUserId } = get()
      if (currentUserId) {
        try {
          const persistKey = `auto-reply:${currentUserId}:${accountId}`
          const snapshot = {
            ...context,
            config: { ...context.config },
          }
          const write = () => {
            storageManager.set('auto-reply', snapshot, {
              level: 'account',
              userId: currentUserId,
              accountId,
            })
          }
          if (options?.immediate) {
            flushPersist(persistKey)
            write()
            return
          }
          schedulePersist(persistKey, write, 250)
        } catch (e) {
          console.error('[AutoReplyConfig] 保存到存储失败:', e)
        }
      }
    }

    return {
      contexts: {},
      currentUserId: null,

      updateConfig: (accountId, configUpdates) =>
        set(state => {
          const context = ensureContext(state, accountId)
          const platform = resolvePlatformForAccount(accountId)
          const newConfig = normalizeConfigForPlatform(
            mergeWithoutArray(context.config, configUpdates),
            platform,
          )
          context.config = newConfig
          saveToStorage(accountId, context)

          const commentListenerStatus =
            useCommentListenerRuntimeStore.getState().contexts[accountId]?.status
          if (commentListenerStatus === 'listening' && window.ipcRenderer) {
            const listenerConfig: CommentListenerConfig = {
              source: newConfig.entry,
              ws: newConfig.ws?.enable ? { port: newConfig.ws.port } : undefined,
            }
            window.ipcRenderer
              .invoke(IPC_CHANNELS.tasks.commentListener.start, accountId, listenerConfig)
              .catch((err: Error) =>
                console.error('[AutoReplyConfig] 同步评论监听配置到主进程失败:', err),
              )
          }
        }),

      loadUserContexts: (userId: string) => {
        const loadContexts = () => {
          flushAllPersists()
          const { accounts } = useAccounts.getState()
          if (accounts.length === 0) {
            return
          }

          set(state => {
            state.currentUserId = userId
            state.contexts = {}

            accounts.forEach(account => {
              const savedContext = storageManager.get<AutoReplyContext>('auto-reply', {
                level: 'account',
                userId,
                accountId: account.id,
              })
              if (savedContext) {
                state.contexts[account.id] = {
                  ...savedContext,
                  config: normalizeConfigForPlatform(savedContext.config, account.platform),
                }
              }
            })
          })
        }

        const { accounts } = useAccounts.getState()
        if (accounts.length > 0) {
          loadContexts()
        } else {
          const unsubscribe = useAccounts.subscribe(state => {
            if (state.accounts.length > 0) {
              unsubscribe()
              loadContexts()
            }
          })
        }
      },

      resetAllContexts: () => {
        set(state => {
          flushAllPersists()
          // 保存当前数据到存储
          const { currentUserId } = state
          if (currentUserId) {
            Object.entries(state.contexts).forEach(([accountId, context]) => {
              try {
                saveToStorage(accountId, context, { immediate: true })
              } catch (e) {
                console.error('[AutoReplyConfig] 保存配置失败:', e)
              }
            })
          }
          state.contexts = {}
          state.currentUserId = null
        })
      },
    }
  }),
)

export const useAutoReplyConfig = () => {
  const store = useAutoReplyConfigStore()
  const currentAccountId = useAccounts(ctx => ctx.currentAccountId)
  const currentPlatform = resolvePlatformForAccount(currentAccountId)
  const config = mergeWithoutArray(
    createDefaultConfig(currentPlatform),
    normalizeConfigForPlatform(
      store.contexts[currentAccountId]?.config ?? createDefaultConfig(currentPlatform),
      currentPlatform,
    ),
  )
  config.entry = getSafeAutoReplyEntry(currentAccountId, config.entry)
  config.comment.aiReply.prompt = normalizeUserPrompt(config.comment.aiReply.prompt)
  config.comment.aiReply.productPrompt = normalizeUserPrompt(config.comment.aiReply.productPrompt)

  return {
    config,
    updateKeywordRules: (rules: AutoReplyConfig['comment']['keywordReply']['rules']) => {
      store.updateConfig(currentAccountId, {
        comment: { keywordReply: { rules } },
      })
    },
    updateAIReplySettings: (settings: DeepPartial<AutoReplyConfig['comment']['aiReply']>) => {
      store.updateConfig(currentAccountId, { comment: { aiReply: settings } })
    },
    updateGeneralSettings: (
      settings: DeepPartial<Pick<AutoReplyConfig, 'entry' | 'hideUsername'>>,
    ) => {
      store.updateConfig(currentAccountId, settings)
    },
    updateEventReplyContents: (
      replyType: EventMessageType,
      contents: SimpleEventReplyMessage[],
    ) => {
      store.updateConfig(currentAccountId, {
        [replyType]: { messages: contents },
      })
    },
    updateBlockList: (blockList: string[]) => {
      store.updateConfig(currentAccountId, { blockList })
    },
    updateKeywordReplyEnabled: (enable: boolean) => {
      store.updateConfig(currentAccountId, {
        comment: { keywordReply: { enable } },
      })
    },
    updateEventReplyEnabled: (replyType: EventMessageType, enable: boolean) => {
      store.updateConfig(currentAccountId, {
        [replyType]: { enable },
      })
    },
    updateEventReplyOptions: <T extends EventMessageType>(
      replyType: T,
      options: AutoReplyConfig[T]['options'],
    ) => {
      store.updateConfig(currentAccountId, {
        [replyType]: { options },
      })
    },
    updateWSConfig: (wsConfig: DeepPartial<AutoReplyConfig['ws']>) => {
      store.updateConfig(currentAccountId, { ws: wsConfig })
    },
    updatePinCommentConfig: (pinCommentConfig: DeepPartial<AutoReplyConfig['pinComment']>) => {
      store.updateConfig(currentAccountId, {
        pinComment: pinCommentConfig,
      })
    },
  }
}

// Hook: 自动加载配置
export function useLoadAutoReplyConfigOnLogin() {
  const { loadUserContexts } = useAutoReplyConfigStore()
  const { isAuthenticated, user } = useAuthStore()

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // 延迟加载，确保存储系统已初始化
      setTimeout(() => {
        loadUserContexts(user.id)
      }, 0)
    }
  }, [isAuthenticated, user?.id, loadUserContexts])
}
