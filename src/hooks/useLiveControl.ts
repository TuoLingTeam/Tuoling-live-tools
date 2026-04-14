import { useEffect, useMemo } from 'react'
import type { StreamStatus } from 'shared/streamStatus'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { type ConnectState, DEFAULT_CONNECT_STATE } from '@/config/platformConfig'
import { deriveLiveSessionMeta } from '@/lib/liveSession'
import { useIsAuthenticated, useUser } from '@/stores/authStore'
import { flushAllPersists, flushPersist, schedulePersist } from '@/utils/debouncedPersist'
import { EVENTS, eventEmitter } from '@/utils/events'
import { storageManager } from '@/utils/storage/StorageManager'
import { useAccounts } from './useAccounts'

type ConnectionStatus = 'connecting' | 'reconnecting' | 'connected' | 'disconnected' | 'error'

interface LiveControlContext {
  connectState: ConnectState
  accountName: string | null
  streamState: StreamStatus
  liveSessionId: string | null
  liveSessionStartedAt: string | null
  liveSessionEndedAt: string | null
}

interface LiveControlStore {
  contexts: Record<string, LiveControlContext>
  currentUserId: string | null
  setConnectState: (accountId: string, connectState: Partial<ConnectState>) => void
  setAccountName: (accountId: string, name: string | null) => void
  setStreamState: (accountId: string, streamState: StreamStatus) => void
  resetConnection: (accountId: string) => void
  loadUserContexts: (userId: string) => void
  resetAllContexts: () => void
}

// 【修复】创建新的默认 context，避免对象引用问题
// 注意：每次调用都创建新对象，避免 immer 的冻结对象问题
function defaultContext(): LiveControlContext {
  return {
    connectState: { ...DEFAULT_CONNECT_STATE },
    accountName: null,
    streamState: 'unknown',
    liveSessionId: null,
    liveSessionStartedAt: null,
    liveSessionEndedAt: null,
  }
}

// 用于 useCurrentLiveControl 的默认返回值（只读，不用于状态修改）
const READONLY_DEFAULT_CONTEXT: LiveControlContext = {
  connectState: { ...DEFAULT_CONNECT_STATE },
  accountName: null,
  streamState: 'unknown',
  liveSessionId: null,
  liveSessionStartedAt: null,
  liveSessionEndedAt: null,
}

export const useLiveControlStore = create<LiveControlStore>()(
  immer((set, get) => {
    eventEmitter.on(EVENTS.ACCOUNT_ADDED, (accountId: string) => {
      set(state => {
        if (!state.contexts[accountId]) {
          state.contexts[accountId] = defaultContext()
        }
      })
    })

    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
        const { currentUserId } = get()
        if (currentUserId) {
          try {
            storageManager.remove('live-control', {
              level: 'account',
              userId: currentUserId,
              accountId,
            })
          } catch (e) {
            console.error('[LiveControl] 删除存储失败:', e)
          }
        }
      })
    })

    const ensureContext = (state: LiveControlStore, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = defaultContext()
      }
      return state.contexts[accountId]
    }

    const saveToStorage = (
      accountId: string,
      context: LiveControlContext,
      options?: { immediate?: boolean },
    ) => {
      const { currentUserId } = get()
      if (currentUserId) {
        try {
          // 不保存 connecting/reconnecting 状态（临时状态）
          const connectState = context.connectState
          const dataToSave = {
            ...context,
            connectState:
              connectState.status === 'connecting' || connectState.status === 'reconnecting'
                ? {
                    ...connectState,
                    status: 'disconnected' as const,
                    error: null,
                    session: null,
                    lastVerifiedAt: null,
                  }
                : connectState,
            liveSessionId: null,
            liveSessionStartedAt: null,
            liveSessionEndedAt: null,
          }
          const persistKey = `live-control:${currentUserId}:${accountId}`
          const write = () => {
            storageManager.set('live-control', dataToSave, {
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
          console.error('[LiveControl] 保存到存储失败:', e)
        }
      }
    }

    return {
      contexts: {
        default: defaultContext(),
      },
      currentUserId: null,

      setConnectState: (accountId, connectStateUpdate) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.connectState = { ...context.connectState, ...connectStateUpdate }
          saveToStorage(accountId, context)
        }),

      setAccountName: (accountId, name) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.accountName = name
          // accountName 不保存到存储
        }),

      setStreamState: (accountId, streamState) =>
        set(state => {
          const context = ensureContext(state, accountId)
          const prevStreamState = context.streamState
          const nextMeta = deriveLiveSessionMeta({
            prevStreamState,
            nextStreamState: streamState,
            current: {
              liveSessionId: context.liveSessionId,
              liveSessionStartedAt: context.liveSessionStartedAt,
              liveSessionEndedAt: context.liveSessionEndedAt,
            },
            nowIso: new Date().toISOString(),
            createId: () => crypto.randomUUID(),
          })
          context.liveSessionId = nextMeta.liveSessionId
          context.liveSessionStartedAt = nextMeta.liveSessionStartedAt
          context.liveSessionEndedAt = nextMeta.liveSessionEndedAt
          context.streamState = streamState
          // streamState 不保存到存储
        }),

      resetConnection: accountId =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.connectState = {
            ...DEFAULT_CONNECT_STATE,
            platform: context.connectState.platform,
          }
          context.streamState = 'unknown'
          saveToStorage(accountId, context)
        }),

      loadUserContexts: (userId: string) => {
        const loadContexts = () => {
          flushAllPersists()
          const { accounts, currentAccountId } = useAccounts.getState()
          if (accounts.length === 0) {
            return
          }

          set(state => {
            state.currentUserId = userId
            // 【修复】保留当前账号的上下文，避免重置平台选择
            // 只重置非当前账号的上下文
            const currentContext = currentAccountId ? state.contexts[currentAccountId] : null
            state.contexts = { default: defaultContext() }

            // 恢复当前账号的上下文（如果存在）
            if (currentContext && currentAccountId) {
              state.contexts[currentAccountId] = currentContext
            }

            accounts.forEach(account => {
              // 【修复】仅在当前账号已有内存上下文时才跳过，避免启动后当前账号无法从存储恢复
              if (account.id === currentAccountId && currentContext) {
                return
              }

              const savedContext = storageManager.get<LiveControlContext>('live-control', {
                level: 'account',
                userId,
                accountId: account.id,
              })
              if (savedContext) {
                const persistedStatus = savedContext.connectState.status
                const safeConnectState =
                  persistedStatus === 'connecting' ||
                  persistedStatus === 'reconnecting' ||
                  persistedStatus === 'connected'
                    ? {
                        ...DEFAULT_CONNECT_STATE,
                        platform: savedContext.connectState.platform || '',
                      }
                    : { ...savedContext.connectState }

                state.contexts[account.id] = {
                  connectState: safeConnectState,
                  accountName: null,
                  streamState: 'unknown',
                  liveSessionId: null,
                  liveSessionStartedAt: null,
                  liveSessionEndedAt: null,
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

      resetAllContexts: () =>
        set(state => {
          flushAllPersists()
          // 保存当前数据到存储
          const { currentUserId } = state
          if (currentUserId) {
            Object.entries(state.contexts).forEach(([accountId, context]) => {
              if (accountId === 'default') return
              try {
                const connectState = context.connectState
                const dataToSave = {
                  ...context,
                  connectState:
                    connectState.status === 'connecting' || connectState.status === 'reconnecting'
                      ? {
                          ...connectState,
                          status: 'disconnected' as const,
                          error: null,
                          session: null,
                          lastVerifiedAt: null,
                        }
                      : connectState,
                }
                storageManager.set('live-control', dataToSave, {
                  level: 'account',
                  userId: currentUserId,
                  accountId,
                })
              } catch (e) {
                console.error('[LiveControl] 保存配置失败:', e)
              }
            })
          }
          state.contexts = { default: defaultContext() }
          state.currentUserId = null
        }),
    }
  }),
)

export const useCurrentLiveControlActions = () => {
  const setConnectState = useLiveControlStore(state => state.setConnectState)
  const setAccountName = useLiveControlStore(state => state.setAccountName)
  const setStreamState = useLiveControlStore(state => state.setStreamState)
  const resetConnection = useLiveControlStore(state => state.resetConnection)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  return useMemo(
    () => ({
      setConnectState: (connectStateUpdate: Partial<ConnectState>) => {
        setConnectState(currentAccountId, connectStateUpdate)
      },
      setAccountName: (name: string | null) => {
        setAccountName(currentAccountId, name)
      },
      setStreamState: (streamState: StreamStatus) => {
        setStreamState(currentAccountId, streamState)
      },
      resetConnection: () => {
        resetConnection(currentAccountId)
      },
      setPlatform: (platform: string) => {
        setConnectState(currentAccountId, { platform })
      },
      setIsConnected: (status: ConnectionStatus) => {
        setConnectState(currentAccountId, { status })
      },
    }),
    [currentAccountId, setConnectState, setAccountName, setStreamState, resetConnection],
  )
}

// 【修复】确保 getSnapshot 返回值稳定
// 使用 READONLY_DEFAULT_CONTEXT 作为默认值（只读，不用于状态修改）
export const useCurrentLiveControl = <T>(getter: (context: LiveControlContext) => T): T => {
  const currentAccountId = useAccounts(state => state.currentAccountId)

  // 使用 useMemo 稳定 selector 函数，避免每次 render 都创建新函数
  const selector = useMemo(
    () => (state: LiveControlStore) => {
      // 使用 READONLY_DEFAULT_CONTEXT 作为默认值，确保返回值稳定
      const context = state.contexts[currentAccountId] ?? READONLY_DEFAULT_CONTEXT
      return getter(context)
    },
    [currentAccountId, getter],
  )

  return useLiveControlStore(selector)
}

// 首发版：统一的 getter 接口
export const useIsConnected = () =>
  useCurrentLiveControl(context => context.connectState.status === 'connected')
export const useConnectionStatus = () =>
  useCurrentLiveControl(context => context.connectState.status)
export const useCurrentPlatform = () =>
  useCurrentLiveControl(context => context.connectState.platform)
export const useStreamStatus = () => useCurrentLiveControl(context => context.streamState)

// Hook: 自动加载配置
export function useLoadLiveControlOnLogin() {
  const { loadUserContexts } = useLiveControlStore()
  const isAuthenticated = useIsAuthenticated()
  const user = useUser()

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // 延迟加载，确保存储系统已初始化
      setTimeout(() => {
        loadUserContexts(user.id)
      }, 0)
    }
  }, [isAuthenticated, user?.id, loadUserContexts])
}
