import { useEffect, useMemo } from 'react'
import type { BrowserCandidate } from 'shared/browser'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useIsAuthenticated, useUser } from '@/stores/authStore'
import { flushAllPersists, flushPersist, schedulePersist } from '@/utils/debouncedPersist'
import { EVENTS, eventEmitter } from '@/utils/events'
import { storageManager } from '@/utils/storage/StorageManager'
import { useAccounts } from './useAccounts'

interface ChromeConfig {
  path: string
  selectedBrowserId: string
  browsers: BrowserCandidate[]
  storageState: string
  headless: boolean
}

interface ChromeConfigStore {
  contexts: Record<string, ChromeConfig>
  currentUserId: string | null
  setPath: (accountId: string, path: string) => void
  setStorageState: (accountId: string, storageState: string) => void
  setHeadless: (accountId: string, headless: boolean) => void
  setBrowsers: (accountId: string, browsers: BrowserCandidate[]) => void
  setSelectedBrowser: (accountId: string, browserId: string) => void
  upsertBrowser: (accountId: string, browser: BrowserCandidate) => void
  updateBrowserStatus: (
    accountId: string,
    browserId: string,
    updates: Pick<BrowserCandidate, 'status' | 'lastError'>,
  ) => void
  loadUserConfigs: (userId: string) => void
  resetAllContexts: () => void
}

const defaultContext = (): ChromeConfig => ({
  path: '',
  selectedBrowserId: '',
  browsers: [],
  storageState: '',
  headless: false,
})

const DEFAULT_CHROME_CONFIG: ChromeConfig = defaultContext()

function normalizePathKey(value: string) {
  return value.trim().toLowerCase()
}

function getBrowserFileName(browserPath: string) {
  const normalized = browserPath.replace(/\\/g, '/')
  return normalized.split('/').pop()?.toLowerCase() || ''
}

function inferBrowserName(browserPath: string) {
  const fileName = getBrowserFileName(browserPath)
  if (fileName === 'msedge.exe') return 'Microsoft Edge'
  if (fileName === 'chrome.exe') return 'Google Chrome'
  if (fileName === 'brave.exe') return 'Brave'
  if (fileName === '360chrome.exe' || fileName === '360se.exe') return '360 极速浏览器'
  if (fileName === 'sogouexplorer.exe') return '搜狗浏览器'
  const normalized = browserPath.replace(/\\/g, '/')
  return normalized.split('/').pop() || browserPath
}

function createCustomBrowserCandidate(browserPath: string): BrowserCandidate {
  return {
    id: `custom:${normalizePathKey(browserPath)}`,
    name: inferBrowserName(browserPath),
    path: browserPath,
    source: 'manual',
    engine: 'chromium',
    status: 'unknown',
    lastError: null,
  }
}

function mergeBrowserCandidates(
  existing: BrowserCandidate[],
  detected: BrowserCandidate[],
): BrowserCandidate[] {
  const merged = new Map<string, BrowserCandidate>()

  for (const browser of existing) {
    merged.set(browser.id, browser)
  }

  for (const browser of detected) {
    const key = browser.id
    const prev = merged.get(key)
    merged.set(
      key,
      prev
        ? {
            ...prev,
            ...browser,
            status: prev.status,
            lastError: prev.lastError,
          }
        : browser,
    )
  }

  return Array.from(merged.values())
}

function syncSelectedBrowser(config: ChromeConfig) {
  const selected = config.browsers.find(browser => browser.id === config.selectedBrowserId)
  if (selected) {
    config.path = selected.path
    return
  }

  const firstBrowser = config.browsers[0]
  if (firstBrowser) {
    config.selectedBrowserId = firstBrowser.id
    config.path = firstBrowser.path
    return
  }

  config.selectedBrowserId = ''
  config.path = ''
}

function migrateLegacyConfig(config: Partial<ChromeConfig> | null | undefined): ChromeConfig {
  const migrated = {
    ...defaultContext(),
    ...(config || {}),
  } as ChromeConfig

  const browsers = Array.isArray(config?.browsers) ? config!.browsers : []
  migrated.browsers = browsers

  if (!migrated.browsers.length && config?.path) {
    migrated.browsers = [createCustomBrowserCandidate(config.path)]
  }

  if (!migrated.selectedBrowserId && migrated.path) {
    const matched = migrated.browsers.find(browser => browser.path === migrated.path)
    migrated.selectedBrowserId = matched?.id || createCustomBrowserCandidate(migrated.path).id
    if (!matched) {
      migrated.browsers = mergeBrowserCandidates(migrated.browsers, [
        createCustomBrowserCandidate(migrated.path),
      ])
    }
  }

  syncSelectedBrowser(migrated)
  return migrated
}

export const useChromeConfigStore = create<ChromeConfigStore>()(
  immer((set, get) => {
    eventEmitter.on(EVENTS.ACCOUNT_REMOVED, (accountId: string) => {
      set(state => {
        delete state.contexts[accountId]
        const { currentUserId } = get()
        if (currentUserId) {
          storageManager.remove('chrome-config', {
            level: 'account',
            userId: currentUserId,
            accountId,
          })
        }
      })
    })

    const ensureContext = (state: ChromeConfigStore, accountId: string) => {
      if (!state.contexts[accountId]) {
        state.contexts[accountId] = defaultContext()
      }
      return state.contexts[accountId]
    }

    const saveToStorage = (
      accountId: string,
      config: ChromeConfig,
      options?: { immediate?: boolean },
    ) => {
      const { currentUserId } = get()
      if (currentUserId) {
        try {
          const persistKey = `chrome-config:${currentUserId}:${accountId}`
          const snapshot = {
            ...config,
            browsers: [...config.browsers],
          }
          const write = () => {
            storageManager.set('chrome-config', snapshot, {
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
          console.error('[ChromeConfig] 保存到存储失败:', e)
        }
      }
    }

    return {
      contexts: {},
      currentUserId: null,

      setPath: (accountId, browserPath) => {
        set(state => {
          const context = ensureContext(state, accountId)
          const browser = createCustomBrowserCandidate(browserPath)
          context.browsers = mergeBrowserCandidates(context.browsers, [browser])
          context.selectedBrowserId = browser.id
          syncSelectedBrowser(context)
          saveToStorage(accountId, context)
        })
      },

      setStorageState: (accountId, storageState) => {
        set(state => {
          const context = ensureContext(state, accountId)
          context.storageState = storageState
          saveToStorage(accountId, context)
        })
      },

      setHeadless: (accountId, headless) => {
        set(state => {
          const context = ensureContext(state, accountId)
          context.headless = headless
          saveToStorage(accountId, context)
        })
      },

      setBrowsers: (accountId, browsers) => {
        set(state => {
          const context = ensureContext(state, accountId)
          context.browsers = mergeBrowserCandidates(context.browsers, browsers)
          syncSelectedBrowser(context)
          saveToStorage(accountId, context)
        })
      },

      setSelectedBrowser: (accountId, browserId) => {
        set(state => {
          const context = ensureContext(state, accountId)
          context.selectedBrowserId = browserId
          syncSelectedBrowser(context)
          saveToStorage(accountId, context)
        })
      },

      upsertBrowser: (accountId, browser) => {
        set(state => {
          const context = ensureContext(state, accountId)
          context.browsers = mergeBrowserCandidates(context.browsers, [browser])
          context.selectedBrowserId = browser.id
          syncSelectedBrowser(context)
          saveToStorage(accountId, context)
        })
      },

      updateBrowserStatus: (accountId, browserId, updates) => {
        set(state => {
          const context = ensureContext(state, accountId)
          const browser = context.browsers.find(item => item.id === browserId)
          if (browser) {
            browser.status = updates.status
            browser.lastError = updates.lastError
          }
          saveToStorage(accountId, context)
        })
      },

      loadUserConfigs: (userId: string) => {
        const loadConfigs = () => {
          flushAllPersists()
          const { accounts } = useAccounts.getState()
          if (accounts.length === 0) {
            return
          }

          set(state => {
            state.currentUserId = userId
            state.contexts = {}

            accounts.forEach(account => {
              const config = storageManager.get<ChromeConfig>('chrome-config', {
                level: 'account',
                userId,
                accountId: account.id,
              })
              if (config) {
                state.contexts[account.id] = migrateLegacyConfig(config)
              }
            })
          })
        }

        const { accounts } = useAccounts.getState()
        if (accounts.length > 0) {
          loadConfigs()
        } else {
          const unsubscribe = useAccounts.subscribe(state => {
            if (state.accounts.length > 0) {
              unsubscribe()
              loadConfigs()
            }
          })
        }
      },

      resetAllContexts: () => {
        set(state => {
          flushAllPersists()
          const { currentUserId } = state
          if (currentUserId) {
            Object.entries(state.contexts).forEach(([accountId, config]) => {
              try {
                storageManager.set('chrome-config', config, {
                  level: 'account',
                  userId: currentUserId,
                  accountId,
                })
              } catch (e) {
                console.error('[ChromeConfig] 保存配置失败:', e)
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

export function useCurrentChromeConfig<T>(getters: (state: ChromeConfig) => T): T {
  const currentAccountId = useAccounts(state => state.currentAccountId)
  return useChromeConfigStore(state => {
    const context = state.contexts[currentAccountId] ?? DEFAULT_CHROME_CONFIG
    return getters(context)
  })
}

export function useCurrentSelectedBrowser() {
  return useCurrentChromeConfig(
    context => context.browsers.find(browser => browser.id === context.selectedBrowserId) ?? null,
  )
}

export function useCurrentChromeConfigActions() {
  const setPath = useChromeConfigStore(state => state.setPath)
  const setStorageState = useChromeConfigStore(state => state.setStorageState)
  const setHeadless = useChromeConfigStore(state => state.setHeadless)
  const setBrowsers = useChromeConfigStore(state => state.setBrowsers)
  const setSelectedBrowser = useChromeConfigStore(state => state.setSelectedBrowser)
  const upsertBrowser = useChromeConfigStore(state => state.upsertBrowser)
  const updateBrowserStatus = useChromeConfigStore(state => state.updateBrowserStatus)
  const currentAccountId = useAccounts(state => state.currentAccountId)

  return useMemo(
    () => ({
      setPath: (browserPath: string) => setPath(currentAccountId, browserPath),
      setStorageState: (storageState: string) => setStorageState(currentAccountId, storageState),
      setHeadless: (headless: boolean) => setHeadless(currentAccountId, headless),
      setBrowsers: (browsers: BrowserCandidate[]) => setBrowsers(currentAccountId, browsers),
      setSelectedBrowser: (browserId: string) => setSelectedBrowser(currentAccountId, browserId),
      upsertBrowser: (browser: BrowserCandidate) => upsertBrowser(currentAccountId, browser),
      updateBrowserStatus: (
        browserId: string,
        updates: Pick<BrowserCandidate, 'status' | 'lastError'>,
      ) => updateBrowserStatus(currentAccountId, browserId, updates),
    }),
    [
      currentAccountId,
      setPath,
      setStorageState,
      setHeadless,
      setBrowsers,
      setSelectedBrowser,
      upsertBrowser,
      updateBrowserStatus,
    ],
  )
}

export function useLoadChromeConfigOnLogin() {
  const isAuthenticated = useIsAuthenticated()
  const user = useUser()
  const loadUserConfigs = useChromeConfigStore(state => state.loadUserConfigs)

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      setTimeout(() => {
        loadUserConfigs(user.id)
      }, 0)
    }
  }, [isAuthenticated, user?.id, loadUserConfigs])
}
