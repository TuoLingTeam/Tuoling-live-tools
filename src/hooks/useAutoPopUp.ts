import { useMemoizedFn, useThrottleFn } from 'ahooks'
import { useEffect, useMemo, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useShallow } from 'zustand/react/shallow'
import { useIsAuthenticated, useUser } from '@/stores/authStore'
import { EVENTS, eventEmitter } from '@/utils/events'
import {
  loadAccountScopedContexts,
  loadSingleAccountScopedContext,
  persistAccountScopedContext,
  persistAllAccountScopedContexts,
  removeAccountScopedContext,
  runWhenAccountsReady,
} from './accountScopedContextStorage'
import { useAccounts } from './useAccounts'
import { useOSPlatform } from './useOSPlatform'

// 快捷键映射类型定义
export interface ShortcutMapping {
  id: string
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  goodsIds: number[]
}

/**
 * 【P1-3】单个商品配置
 * 支持为每个商品单独设置弹窗间隔
 */
export interface GoodsItemConfig {
  id: number
  interval?: [number, number] // 可选：单独设置间隔（毫秒）
  title?: string
  shortTitle?: string
  priceText?: string
  promoText?: string
  stockText?: string
  highlights?: string[]
  aliases?: string[]
  faq?: Array<{
    q: string
    a: string
  }>
}

export interface AutoPopUpConfig {
  scheduler: {
    interval: [number, number] // 全局默认间隔（毫秒）
  }
  goods: GoodsItemConfig[] // 商品配置列表
  random: boolean
}

export type KnowledgeSampleDecisionStatus = 'adopted' | 'dismissed'

export interface KnowledgeSampleDecision {
  status: KnowledgeSampleDecisionStatus
  decidedAt: string
}

type LegacyAutoPopUpConfig = AutoPopUpConfig & {
  goodsIds?: number[]
}

interface AutoPopUpContext {
  isRunning: boolean
  config: AutoPopUpConfig
  shortcuts?: ShortcutMapping[]
  isGlobalShortcut?: boolean
  goodsAutoFillAttempted?: boolean
  goodsAutoFillLocked?: boolean
  knowledgeSampleDecisions?: Record<string, KnowledgeSampleDecision | KnowledgeSampleDecisionStatus>
}

const defaultContext = (): AutoPopUpContext => ({
  isRunning: false,
  config: {
    scheduler: {
      interval: [30000, 45000],
    },
    goods: [], // 【P1-3】使用 goods 替代 goodsIds
    random: false,
  },
  shortcuts: [],
  goodsAutoFillAttempted: false,
  goodsAutoFillLocked: false,
  knowledgeSampleDecisions: {},
})

interface AutoPopUpStore {
  contexts: Record<string, AutoPopUpContext>
  currentUserId: string | null
  setIsRunning: (accountId: string, running: boolean) => void
  setConfig: (accountId: string, config: Partial<AutoPopUpConfig>) => void
  setShortcuts: (accountId: string, shortcuts: ShortcutMapping[]) => void
  setGlobalShortcut: (accountId: string, globalShortcut: boolean) => void
  setGoodsAutoFillState: (
    accountId: string,
    state: Partial<Pick<AutoPopUpContext, 'goodsAutoFillAttempted' | 'goodsAutoFillLocked'>>,
  ) => void
  setKnowledgeSampleDecision: (
    accountId: string,
    sampleKey: string,
    decision?: KnowledgeSampleDecisionStatus,
  ) => void
  ensureContextLoaded: (userId: string, accountId: string) => void
  loadUserContexts: (userId: string) => void
  resetAllContexts: () => void
}

function normalizeKnowledgeSampleDecisions(
  decisions?: Record<string, KnowledgeSampleDecision | KnowledgeSampleDecisionStatus>,
) {
  const normalized: Record<string, KnowledgeSampleDecision> = {}
  for (const [key, value] of Object.entries(decisions ?? {})) {
    if (typeof value === 'string') {
      normalized[key] = {
        status: value,
        decidedAt: '',
      }
      continue
    }
    if (value?.status) {
      normalized[key] = {
        status: value.status,
        decidedAt: value.decidedAt ?? '',
      }
    }
  }
  return normalized
}

export const useAutoPopUpStore = create<AutoPopUpStore>()(
  immer((set, get) => {
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
        removeAccountScopedContext('auto-popup', get().currentUserId, accountId, '[AutoPopUp]')
      })
    })

    const ensureContext = (state: AutoPopUpStore, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = defaultContext()
      }
      return state.contexts[accountId]
    }

    const saveToStorage = (accountId: string, context: AutoPopUpContext) => {
      persistAccountScopedContext({
        namespace: 'auto-popup',
        userId: get().currentUserId,
        accountId,
        context,
        logPrefix: '[AutoPopUp]',
        serialize: savedContext => ({
          ...savedContext,
          isRunning: false,
        }),
      })
    }

    return {
      contexts: {},
      currentUserId: null,

      setIsRunning: (accountId, running) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isRunning = running
          // isRunning 不保存到存储
        }),

      setConfig: (accountId, config) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.config = {
            ...state.contexts[accountId].config,
            ...config,
          }
          saveToStorage(accountId, context)

          // 【P1-2 运行时配置热更新】如果任务正在运行，同步更新到主进程
          if (context.isRunning) {
            if (context.config.goods.length === 0) {
              context.isRunning = false
              window.ipcRenderer
                .invoke(IPC_CHANNELS.tasks.autoPopUp.stop, accountId)
                .catch((err: Error) => console.error('[AutoPopUp] 停止主进程任务失败:', err))
              return
            }

            window.ipcRenderer
              .invoke(IPC_CHANNELS.tasks.autoPopUp.updateConfig, accountId, config)
              .catch((err: Error) => console.error('[AutoPopUp] 同步配置到主进程失败:', err))
          }
        }),

      setShortcuts: (accountId, shortcuts) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.shortcuts = shortcuts
          saveToStorage(accountId, context)
        }),

      setGlobalShortcut: (accountId, value) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.isGlobalShortcut = value
          saveToStorage(accountId, context)
        }),

      setGoodsAutoFillState: (accountId, autoFillState) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.goodsAutoFillAttempted =
            autoFillState.goodsAutoFillAttempted ?? context.goodsAutoFillAttempted
          context.goodsAutoFillLocked =
            autoFillState.goodsAutoFillLocked ?? context.goodsAutoFillLocked
          saveToStorage(accountId, context)
        }),

      setKnowledgeSampleDecision: (accountId, sampleKey, decision) =>
        set(state => {
          const context = ensureContext(state, accountId)
          context.knowledgeSampleDecisions = normalizeKnowledgeSampleDecisions(
            context.knowledgeSampleDecisions,
          )
          if (!decision) {
            delete context.knowledgeSampleDecisions[sampleKey]
          } else {
            context.knowledgeSampleDecisions[sampleKey] = {
              status: decision,
              decidedAt: new Date().toISOString(),
            }
          }
          saveToStorage(accountId, context)
        }),

      ensureContextLoaded: (userId, accountId) => {
        const loadContext = () => {
          set(state => {
            if (state.contexts[accountId]) {
              console.log(`[AutoPopUp] Context already loaded for account ${accountId}, skip`)
              return
            }

            state.currentUserId = userId
            const restored = loadSingleAccountScopedContext<AutoPopUpContext, 'auto-popup'>({
              namespace: 'auto-popup',
              userId,
              accountId,
              restoreContext: (savedContext, restoredAccountId) => {
                const nextContext: AutoPopUpContext = {
                  ...savedContext,
                  config: {
                    ...savedContext.config,
                  },
                  isRunning: false,
                  goodsAutoFillAttempted: savedContext.goodsAutoFillAttempted ?? false,
                  goodsAutoFillLocked: savedContext.goodsAutoFillLocked ?? false,
                  knowledgeSampleDecisions: normalizeKnowledgeSampleDecisions(
                    savedContext.knowledgeSampleDecisions,
                  ),
                }
                const legacyConfig = nextContext.config as LegacyAutoPopUpConfig
                if (
                  legacyConfig.goodsIds &&
                  legacyConfig.goodsIds.length > 0 &&
                  (!nextContext.config.goods || nextContext.config.goods.length === 0)
                ) {
                  nextContext.config.goods = legacyConfig.goodsIds.map(id => ({ id }))
                  console.log(
                    `[AutoPopUp] 数据迁移: account ${restoredAccountId} goodsIds -> goods`,
                  )
                }
                return nextContext
              },
            })

            console.log(
              `[AutoPopUp] Hydrating single account context for ${accountId}: ${restored ? 'restored' : 'created-default'}`,
            )
            state.contexts[accountId] = restored ?? defaultContext()
          })
        }

        runWhenAccountsReady(loadContext)
      },

      loadUserContexts: (userId: string) => {
        const loadContexts = () => {
          set(state => {
            const prevContexts: Record<string, AutoPopUpContext> =
              state.currentUserId === userId ? state.contexts : {}
            state.currentUserId = userId
            const loadedContexts = loadAccountScopedContexts<AutoPopUpContext, 'auto-popup'>({
              namespace: 'auto-popup',
              userId,
              restoreContext: (savedContext, accountId) => {
                const nextContext: AutoPopUpContext = {
                  ...savedContext,
                  config: {
                    ...savedContext.config,
                  },
                  isRunning: false,
                  goodsAutoFillAttempted: savedContext.goodsAutoFillAttempted ?? false,
                  goodsAutoFillLocked: savedContext.goodsAutoFillLocked ?? false,
                  knowledgeSampleDecisions: normalizeKnowledgeSampleDecisions(
                    savedContext.knowledgeSampleDecisions,
                  ),
                }
                const legacyConfig = nextContext.config as LegacyAutoPopUpConfig
                if (
                  legacyConfig.goodsIds &&
                  legacyConfig.goodsIds.length > 0 &&
                  (!nextContext.config.goods || nextContext.config.goods.length === 0)
                ) {
                  nextContext.config.goods = legacyConfig.goodsIds.map(id => ({ id }))
                  console.log(`[AutoPopUp] 数据迁移: account ${accountId} goodsIds -> goods`)
                }
                return nextContext
              },
            })

            console.log(
              `[AutoPopUp] Loading all contexts for user ${userId}: loaded=${Object.keys(loadedContexts).length}, prev=${Object.keys(prevContexts).length}`,
            )
            state.contexts = loadedContexts

            for (const [accountId, existingContext] of Object.entries(prevContexts)) {
              if (!existingContext) continue

              if (existingContext.isRunning || !state.contexts[accountId]) {
                console.log(
                  `[AutoPopUp] Preserving in-memory context for ${accountId}: isRunning=${existingContext.isRunning}`,
                )
                state.contexts[accountId] = existingContext
              }
            }
          })
        }

        runWhenAccountsReady(loadContexts)
      },

      resetAllContexts: () => {
        set(state => {
          persistAllAccountScopedContexts({
            namespace: 'auto-popup',
            userId: state.currentUserId,
            contexts: state.contexts,
            logPrefix: '[AutoPopUp]',
            serialize: savedContext => ({
              ...savedContext,
              isRunning: false,
            }),
          })
          state.contexts = {}
          state.currentUserId = null
        })
      },
    }
  }),
)

export const useAutoPopUpActions = () => {
  const setIsRunning = useAutoPopUpStore(state => state.setIsRunning)
  const setConfig = useAutoPopUpStore(state => state.setConfig)
  const setShortcuts = useAutoPopUpStore(state => state.setShortcuts)
  const setGlobalShortcut = useAutoPopUpStore(state => state.setGlobalShortcut)
  const setGoodsAutoFillState = useAutoPopUpStore(state => state.setGoodsAutoFillState)
  const setKnowledgeSampleDecision = useAutoPopUpStore(state => state.setKnowledgeSampleDecision)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const updateConfig = useMemoizedFn((newConfig: Partial<AutoPopUpConfig>) => {
    setConfig(currentAccountId, newConfig)
  })
  return useMemo(
    () => ({
      setIsRunning: (running: boolean) => setIsRunning(currentAccountId, running),
      setScheduler: (scheduler: AutoPopUpConfig['scheduler']) => updateConfig({ scheduler }),
      setGoods: (goods: AutoPopUpConfig['goods']) => updateConfig({ goods }),
      setRandom: (random: boolean) => updateConfig({ random }),
      // 添加设置快捷键映射的方法
      setShortcuts: (shortcuts: ShortcutMapping[]) => setShortcuts(currentAccountId, shortcuts),
      // 添加单个快捷键映射
      addShortcut: (shortcut: ShortcutMapping) => {
        const currentShortcuts =
          useAutoPopUpStore.getState().contexts[currentAccountId]?.shortcuts ?? []
        setShortcuts(currentAccountId, [shortcut, ...currentShortcuts])
      },
      updateShortcut: (shortcut: ShortcutMapping) => {
        const currentShortcuts =
          useAutoPopUpStore.getState().contexts[currentAccountId]?.shortcuts ?? []
        setShortcuts(
          currentAccountId,
          currentShortcuts.map(s => (s.id === shortcut.id ? shortcut : s)),
        )
      },
      // 删除快捷键映射
      removeShortcut: (id: string) => {
        const currentShortcuts =
          useAutoPopUpStore.getState().contexts[currentAccountId]?.shortcuts || []
        setShortcuts(
          currentAccountId,
          currentShortcuts.filter(s => s.id !== id),
        )
      },
      setGlobalShortcut: (value: boolean) => {
        setGlobalShortcut(currentAccountId, value)
      },
      setGoodsAutoFillState: (
        autoFillState: Partial<
          Pick<AutoPopUpContext, 'goodsAutoFillAttempted' | 'goodsAutoFillLocked'>
        >,
      ) => {
        setGoodsAutoFillState(currentAccountId, autoFillState)
      },
      setKnowledgeSampleDecision: (sampleKey: string, decision?: 'adopted' | 'dismissed') => {
        setKnowledgeSampleDecision(currentAccountId, sampleKey, decision)
      },
    }),
    [
      currentAccountId,
      setIsRunning,
      updateConfig,
      setShortcuts,
      setGlobalShortcut,
      setGoodsAutoFillState,
      setKnowledgeSampleDecision,
    ],
  )
}

// 添加快捷键监听 hook
export const useShortcutListener = () => {
  const shortcuts = useCurrentAutoPopUp(context => context.shortcuts)
  const isRunning = useCurrentAutoPopUp(context => context.isRunning)
  const isGlobalShortcut = useCurrentAutoPopUp(ctx => ctx.isGlobalShortcut)
  const platform = useOSPlatform()
  const accountId = useAccounts(s => s.currentAccountId)

  // 全局的
  useEffect(() => {
    if (!isGlobalShortcut) return
    if (!isRunning) return
    if (!shortcuts || shortcuts.length === 0) return

    const mappedShortcuts = shortcuts.map(sc => {
      const accelerator = [
        sc.ctrl && 'CommandOrControl',
        sc.alt && 'Alt',
        sc.shift && 'Shift',
        sc.key,
      ]
        .filter(Boolean)
        .join('+')

      return {
        accelerator,
        goodsIds: sc.goodsIds,
      }
    })

    window.autoPopUpAPI.registerShortcuts(accountId, mappedShortcuts)

    return () => {
      window.autoPopUpAPI.unregisterShortcuts(accountId)
    }
  }, [isGlobalShortcut, shortcuts, isRunning, accountId])

  const throttledKeydown = useThrottleFn(
    (e: KeyboardEvent, shortcuts: ShortcutMapping[]) => {
      // 检查是否有匹配的快捷键
      const shortcut = shortcuts.find(s => s.key.toLocaleLowerCase() === e.key.toLocaleLowerCase())
      if (
        shortcut &&
        !!shortcut.ctrl ===
          // Mac 系统可以用 Command 代替 Ctrl，也可以使用 Control
          ((platform === 'MacOS' && e.metaKey) || e.ctrlKey) &&
        !!shortcut.alt === e.altKey &&
        !!shortcut.shift === e.shiftKey
      ) {
        window.autoPopUpAPI.updateConfig(accountId, {
          goods: shortcut.goodsIds.map(id => ({ id })),
        })
      }
    },
    { wait: 1000, trailing: false },
  )

  // 局部的
  useEffect(() => {
    if (isGlobalShortcut) return
    if (!isRunning) return
    if (!shortcuts || shortcuts.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查是否有匹配的快捷键
      throttledKeydown.run(e, shortcuts)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [shortcuts, isRunning, isGlobalShortcut, throttledKeydown])
}

export const useCurrentAutoPopUp = <T>(getter: (context: AutoPopUpContext) => T): T => {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const { ensureContextLoaded } = useAutoPopUpStore()
  const user = useUser()

  useEffect(() => {
    if (currentAccountId && user?.id) {
      const state = useAutoPopUpStore.getState()
      if (!state.contexts[currentAccountId]) {
        ensureContextLoaded(user.id, currentAccountId)
      }
    }
  }, [currentAccountId, user?.id, ensureContextLoaded])

  const defaultContextRef = useRef(defaultContext())
  return useAutoPopUpStore(
    useShallow(state => {
      const context = state.contexts[currentAccountId] ?? defaultContextRef.current
      return getter(context)
    }),
  )
}

// Hook: 自动加载配置
export function useLoadAutoPopUpOnLogin() {
  const { loadUserContexts } = useAutoPopUpStore()
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
