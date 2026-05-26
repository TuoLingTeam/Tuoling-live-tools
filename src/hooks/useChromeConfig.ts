import { useEffect, useMemo } from 'react'
import {
  type BrowserCandidate,
  getKnownBrowserName,
  validateBrowserExecutablePath,
} from 'shared/browser'
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
  headlessUserSet?: boolean
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

export function shouldDefaultHeadlessForPlatform(platform?: LiveControlPlatform | null) {
  return platform === 'douyin' || platform === 'buyin'
}

const defaultContext = (platform?: LiveControlPlatform | null): ChromeConfig => ({
  path: '',
  selectedBrowserId: '',
  browsers: [],
  storageState: '',
  headless: shouldDefaultHeadlessForPlatform(platform),
  headlessUserSet: false,
})

const DEFAULT_HEADED_CHROME_CONFIG: ChromeConfig = defaultContext()
const DEFAULT_HEADLESS_CHROME_CONFIG: ChromeConfig = defaultContext('douyin')

function getDefaultContextForPlatform(platform?: LiveControlPlatform | null) {
  return shouldDefaultHeadlessForPlatform(platform)
    ? DEFAULT_HEADLESS_CHROME_CONFIG
    : DEFAULT_HEADED_CHROME_CONFIG
}

function normalizePathKey(value: string) {
  return value.trim().toLowerCase()
}

function sanitizeBrowserCandidate(browser: BrowserCandidate): BrowserCandidate | null {
  const validation = validateBrowserExecutablePath(browser.path)
  if (!validation.valid) {
    return null
  }

  return {
    ...browser,
    name: browser.name || validation.browserName,
    path: validation.normalizedPath,
  }
}

function createCustomBrowserCandidate(browserPath: string): BrowserCandidate | null {
  const validation = validateBrowserExecutablePath(browserPath)
  if (!validation.valid) {
    return null
  }

  return {
    id: `custom:${normalizePathKey(validation.normalizedPath)}`,
    name: getKnownBrowserName(validation.normalizedPath),
    path: validation.normalizedPath,
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
    const sanitized = sanitizeBrowserCandidate(browser)
    if (sanitized) {
      merged.set(sanitized.id, sanitized)
    }
  }

  for (const browser of detected) {
    const sanitized = sanitizeBrowserCandidate(browser)
    if (!sanitized) {
      continue
    }

    const key = sanitized.id
    const prev = merged.get(key)
    merged.set(
      key,
      prev
        ? {
            ...prev,
            ...sanitized,
            status: prev.status,
            lastError: prev.lastError,
          }
        : sanitized,
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

function migrateLegacyConfig(
  config: Partial<ChromeConfig> | null | undefined,
  platform?: LiveControlPlatform | null,
): ChromeConfig {
  const migrated = {
    ...defaultContext(platform),
    ...(config || {}),
  } as ChromeConfig

  if (shouldDefaultHeadlessForPlatform(platform) && config?.headlessUserSet !== true) {
    migrated.headless = true
  }

  const browsers = Array.isArray(config?.browsers)
    ? config!.browsers
        .map(browser => sanitizeBrowserCandidate(browser))
        .filter((browser): browser is BrowserCandidate => !!browser)
    : []
  migrated.browsers = browsers

  if (!migrated.browsers.length && config?.path) {
    const legacyBrowser = createCustomBrowserCandidate(config.path)
    migrated.browsers = legacyBrowser ? [legacyBrowser] : []
  }

  if (!migrated.selectedBrowserId && migrated.path) {
    const matched = migrated.browsers.find(browser => browser.path === migrated.path)
    const legacyBrowser = createCustomBrowserCandidate(migrated.path)
    migrated.selectedBrowserId = matched?.id || legacyBrowser?.id || ''
    if (!matched && legacyBrowser) {
      migrated.browsers = mergeBrowserCandidates(migrated.browsers, [legacyBrowser])
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
        const platform = useAccounts
          .getState()
          .accounts.find(account => account.id === accountId)?.platform
        state.contexts[accountId] = defaultContext(platform)
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
          const plainSnapshot = JSON.parse(JSON.stringify(snapshot)) as ChromeConfig
          const write = () => {
            storageManager.set('chrome-config', plainSnapshot, {
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
          if (!browser) {
            return
          }
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
          context.headlessUserSet = true
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
          const sanitized = sanitizeBrowserCandidate(browser)
          if (!sanitized) {
            return
          }
          context.browsers = mergeBrowserCandidates(context.browsers, [sanitized])
          context.selectedBrowserId = sanitized.id
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
                state.contexts[account.id] = migrateLegacyConfig(config, account.platform)
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
  const currentPlatform = useAccounts(
    state => state.accounts.find(account => account.id === currentAccountId)?.platform,
  )
  return useChromeConfigStore(state => {
    const context =
      state.contexts[currentAccountId] ?? getDefaultContextForPlatform(currentPlatform)
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
