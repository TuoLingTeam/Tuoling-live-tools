import { beforeEach, describe, expect, it } from 'vitest'
import {
  createBindingAccountId,
  isActiveBindingAccountId,
  isBindingAccountId,
  normalizeAccountSelection,
  normalizePlatformAccountName,
  useAccounts,
} from '@/hooks/useAccounts'

describe('normalizeAccountSelection', () => {
  const accounts = [
    { id: 'acc-1', name: '账号1' },
    { id: 'acc-2', name: '账号2' },
    { id: 'acc-3', name: '账号3' },
  ]

  it('keeps valid current id and ignores legacy default id', () => {
    expect(normalizeAccountSelection(accounts, 'acc-2', 'acc-3')).toEqual({
      currentAccountId: 'acc-2',
      defaultAccountId: null,
    })
  })

  it('falls back current to first account when current is invalid', () => {
    expect(normalizeAccountSelection(accounts, 'missing', 'acc-3')).toEqual({
      currentAccountId: 'acc-1',
      defaultAccountId: null,
    })
  })

  it('falls back to first account when current is empty', () => {
    expect(normalizeAccountSelection(accounts, '', 'missing')).toEqual({
      currentAccountId: 'acc-1',
      defaultAccountId: null,
    })
  })

  it('returns empty selection when account list is empty', () => {
    expect(normalizeAccountSelection([], 'acc-1', 'acc-1')).toEqual({
      currentAccountId: '',
      defaultAccountId: null,
    })
  })
})

describe('platform account name binding', () => {
  beforeEach(() => {
    useAccounts.setState({
      accounts: [],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })
  })

  it('creates draft ids for platform binding sessions', () => {
    const id = createBindingAccountId()
    expect(isBindingAccountId(id)).toBe(true)
    expect(isBindingAccountId('acc-1')).toBe(false)
  })

  it('only treats bind-prefixed ids as active while they are still pending', () => {
    const id = createBindingAccountId()

    expect(isActiveBindingAccountId(id, [])).toBe(false)
    expect(isActiveBindingAccountId(id, [id])).toBe(true)
    expect(isActiveBindingAccountId('acc-1', [id])).toBe(false)
  })

  it('normalizes platform names before binding', () => {
    expect(normalizePlatformAccountName(' 小冉优选 ')).toBe('小冉优选')
    expect(normalizePlatformAccountName('')).toBeNull()
    expect(normalizePlatformAccountName(null)).toBeNull()
  })

  it('creates the visible account only after a binding draft gets a platform account name', () => {
    const draftId = createBindingAccountId()

    useAccounts.setState({
      accounts: [],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })

    useAccounts.getState().startAccountBinding(draftId)
    const result = useAccounts.getState().bindPlatformAccountName(draftId, '小冉优选', 'buyin')

    expect(result).toEqual({
      updated: true,
      created: true,
      nextName: '小冉优选',
    })
    expect(useAccounts.getState()).toMatchObject({
      accounts: [{ id: draftId, name: '小冉优选', platform: 'buyin' }],
      currentAccountId: draftId,
      bindingAccountIds: [],
    })
  })

  it('switches to an existing bound account instead of creating a duplicate', () => {
    const draftId = createBindingAccountId()

    useAccounts.setState({
      accounts: [{ id: 'acc-1', name: '小冉优选', platform: 'buyin' }],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })

    useAccounts.getState().startAccountBinding(draftId)
    const result = useAccounts.getState().bindPlatformAccountName(draftId, '小冉优选', 'buyin')

    expect(result).toEqual({
      updated: false,
      duplicateAccountId: 'acc-1',
      nextName: '小冉优选',
    })
    expect(useAccounts.getState()).toMatchObject({
      accounts: [{ id: 'acc-1', name: '小冉优选', platform: 'buyin' }],
      currentAccountId: 'acc-1',
    })
  })

  it('treats an existing legacy account with the same name as the binding target', () => {
    const draftId = createBindingAccountId()

    useAccounts.setState({
      accounts: [{ id: 'acc-1', name: '小冉优选' }],
      currentAccountId: '',
      defaultAccountId: null,
      currentUserId: null,
      bindingAccountIds: [],
    })

    useAccounts.getState().startAccountBinding(draftId)
    const result = useAccounts.getState().bindPlatformAccountName(draftId, '小冉优选', 'buyin')

    expect(result).toEqual({
      updated: false,
      duplicateAccountId: 'acc-1',
      nextName: '小冉优选',
    })
    expect(useAccounts.getState()).toMatchObject({
      accounts: [{ id: 'acc-1', name: '小冉优选', platform: 'buyin' }],
      currentAccountId: 'acc-1',
    })
  })

  it('ignores a cancelled binding draft when a late account name arrives', () => {
    const draftId = createBindingAccountId()

    useAccounts.getState().startAccountBinding(draftId)
    useAccounts.getState().cancelAccountBinding(draftId)

    const result = useAccounts.getState().bindPlatformAccountName(draftId, '小冉优选', 'buyin')

    expect(result).toEqual({ updated: false })
    expect(useAccounts.getState()).toMatchObject({
      accounts: [],
      currentAccountId: '',
    })
  })

  it('can force-complete a draft from the connect result after the IPC event is missed', () => {
    const draftId = createBindingAccountId()

    const result = useAccounts.getState().bindPlatformAccountName(draftId, '小冉优选', 'buyin', {
      allowInactiveBinding: true,
    })

    expect(result).toEqual({
      updated: true,
      created: true,
      nextName: '小冉优选',
    })
    expect(useAccounts.getState()).toMatchObject({
      accounts: [{ id: draftId, name: '小冉优选', platform: 'buyin' }],
      currentAccountId: draftId,
    })
  })
})
