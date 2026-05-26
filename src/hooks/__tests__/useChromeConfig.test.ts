import { beforeEach, describe, expect, it } from 'vitest'
import { useAccounts } from '@/hooks/useAccounts'
import { shouldDefaultHeadlessForPlatform, useChromeConfigStore } from '@/hooks/useChromeConfig'
import { initializeStorage } from '@/utils/storage/init'

const localStorageData = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    clear: () => localStorageData.clear(),
    getItem: (key: string) => localStorageData.get(key) ?? null,
    key: (index: number) => Array.from(localStorageData.keys())[index] ?? null,
    removeItem: (key: string) => localStorageData.delete(key),
    setItem: (key: string, value: string) => {
      localStorageData.set(key, value)
    },
    get length() {
      return localStorageData.size
    },
  },
})
Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: globalThis.localStorage,
  },
})

describe('useChromeConfig platform defaults', () => {
  beforeEach(() => {
    initializeStorage()
    useAccounts.setState({
      accounts: [],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })
    useChromeConfigStore.setState({
      contexts: {},
      currentUserId: null,
    })
    localStorage.clear()
  })

  it('defaults headless mode only for douyin and buyin', () => {
    expect(shouldDefaultHeadlessForPlatform('douyin')).toBe(true)
    expect(shouldDefaultHeadlessForPlatform('buyin')).toBe(true)
    expect(shouldDefaultHeadlessForPlatform('taobao')).toBe(false)
    expect(shouldDefaultHeadlessForPlatform('wxchannel')).toBe(false)
    expect(shouldDefaultHeadlessForPlatform(undefined)).toBe(false)
  })

  it('creates new douyin and buyin account browser configs as headless', () => {
    useAccounts.setState({
      accounts: [
        { id: 'acc-douyin', name: '抖音账号', platform: 'douyin' },
        { id: 'acc-buyin', name: '百应账号', platform: 'buyin' },
        { id: 'acc-taobao', name: '淘宝账号', platform: 'taobao' },
      ],
      currentAccountId: 'acc-douyin',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })

    const store = useChromeConfigStore.getState()
    store.setBrowsers('acc-douyin', [])
    store.setBrowsers('acc-buyin', [])
    store.setBrowsers('acc-taobao', [])

    expect(useChromeConfigStore.getState().contexts['acc-douyin']?.headless).toBe(true)
    expect(useChromeConfigStore.getState().contexts['acc-buyin']?.headless).toBe(true)
    expect(useChromeConfigStore.getState().contexts['acc-taobao']?.headless).toBe(false)
  })

  it('keeps a manual headless override for default-headless platforms', () => {
    useAccounts.setState({
      accounts: [{ id: 'acc-douyin', name: '抖音账号', platform: 'douyin' }],
      currentAccountId: 'acc-douyin',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })

    useChromeConfigStore.getState().setHeadless('acc-douyin', false)

    expect(useChromeConfigStore.getState().contexts['acc-douyin']?.headless).toBe(false)
    expect(useChromeConfigStore.getState().contexts['acc-douyin']?.headlessUserSet).toBe(true)
  })

  it('migrates old douyin and buyin configs to the platform headless default', () => {
    const userId = 'user-1'
    useAccounts.setState({
      accounts: [
        { id: 'acc-buyin', name: '百应账号', platform: 'buyin' },
        { id: 'acc-taobao', name: '淘宝账号', platform: 'taobao' },
      ],
      currentAccountId: 'acc-buyin',
      defaultAccountId: null,
      currentUserId: userId,
      bindingAccountIds: [],
    })

    localStorage.setItem(
      `xiuer-chrome-config-${userId}-acc-buyin`,
      JSON.stringify({
        path: '',
        selectedBrowserId: '',
        browsers: [],
        storageState: '',
        headless: false,
      }),
    )
    localStorage.setItem(
      `xiuer-chrome-config-${userId}-acc-taobao`,
      JSON.stringify({
        path: '',
        selectedBrowserId: '',
        browsers: [],
        storageState: '',
        headless: false,
      }),
    )

    useChromeConfigStore.getState().loadUserConfigs(userId)

    expect(useChromeConfigStore.getState().contexts['acc-buyin']?.headless).toBe(true)
    expect(useChromeConfigStore.getState().contexts['acc-taobao']?.headless).toBe(false)
  })
})
