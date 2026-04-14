import type { ChangeEvent } from 'react'
import { SUB_ACCOUNT_WORKSPACE_ID } from 'shared/subAccountWorkspace'
import type { SubAccount as SubAccountItem } from '@/hooks/useSubAccount'
import type { Actions, ToastApi } from './subAccountControllerActionTypes'

export async function syncAccountsFromBackend(
  accounts: SubAccountItem[],
  actions: Actions,
): Promise<void> {
  const list = await window.subAccountAPI.getAllAccounts(SUB_ACCOUNT_WORKSPACE_ID)
  if (!Array.isArray(list)) return

  const currentGroups = new Map(accounts.map(account => [account.id, account.group]))
  actions.setAccounts(
    list.map((account: any) => ({
      ...account,
      group: currentGroups.get(account.id),
      stats: account.stats || { totalSent: 0, successCount: 0, failCount: 0 },
    })),
  )
}

export async function addSubAccount({
  newAccountName,
  newAccountPlatform,
  actions,
  toast,
  setNewAccountName,
  setIsAdding,
}: {
  newAccountName: string
  newAccountPlatform: string
  actions: Actions
  toast: ToastApi
  setNewAccountName: (value: string) => void
  setIsAdding: (value: boolean) => void
}) {
  if (!newAccountName.trim()) {
    toast.warning({
      title: '请输入小号名称',
      description: '填写名称后才能创建小号。',
      dedupeKey: 'subaccount-name-required',
    })
    return
  }

  const newAccount: SubAccountItem = {
    id: crypto.randomUUID(),
    name: newAccountName.trim(),
    platform: newAccountPlatform as LiveControlPlatform,
    status: 'idle',
    hasStorageState: false,
    liveRoomStatus: 'idle',
    stats: {
      totalSent: 0,
      successCount: 0,
      failCount: 0,
    },
  }

  const result = await window.subAccountAPI.addAccount(SUB_ACCOUNT_WORKSPACE_ID, {
    id: newAccount.id,
    name: newAccount.name,
    platform: newAccount.platform,
  })

  if (result) {
    actions.addAccount(newAccount)
    toast.success({
      title: '小号已添加',
      description: `已创建小号“${newAccount.name}”。`,
      dedupeKey: `subaccount-added:${newAccount.id}`,
    })
    setNewAccountName('')
    setIsAdding(false)
  } else {
    toast.error({
      title: '添加失败',
      description: '小号创建失败，请稍后重试。',
      dedupeKey: 'subaccount-add-failed',
    })
  }
}

export async function removeSubAccount(
  accountId: string,
  accounts: SubAccountItem[],
  actions: Actions,
  toast: ToastApi,
) {
  const account = accounts.find(item => item.id === accountId)
  if (!account) return

  await window.subAccountAPI.removeAccount(SUB_ACCOUNT_WORKSPACE_ID, accountId)
  actions.removeAccount(accountId)
  toast.info({
    title: '小号已移除',
    description: `已删除小号“${account.name}”。`,
    dedupeKey: `subaccount-removed:${accountId}`,
  })
}

export async function loginSubAccount(
  accountId: string,
  accounts: SubAccountItem[],
  actions: Actions,
  toast: ToastApi,
) {
  const account = accounts.find(item => item.id === accountId)
  if (!account) return

  actions.updateAccountStatus(accountId, 'connecting')
  toast.info({
    title: '正在登录小号',
    description: `请在新打开的浏览器中完成“${account.name}”的观众登录。`,
    dedupeKey: `subaccount-login-start:${accountId}`,
  })

  const result = await window.subAccountAPI.loginAccount(SUB_ACCOUNT_WORKSPACE_ID, accountId)

  if (result.success) {
    const newStatus = result.session?.status || 'connected'
    actions.updateAccountStatus(accountId, newStatus, result.session?.error)

    if (newStatus === 'connected') {
      toast.success({
        title: '登录成功',
        description: `小号“${account.name}”已完成登录。`,
        dedupeKey: `subaccount-login-success:${accountId}`,
      })
    } else {
      toast.warning({
        title: '等待人工验证',
        description: `小号“${account.name}”需要在浏览器中完成平台验证。`,
        dedupeKey: `subaccount-login-verify:${accountId}`,
      })
    }
  } else {
    actions.updateAccountStatus(accountId, 'error', result.error)
    toast.error({
      title: '登录失败',
      description: `小号“${account.name}”登录失败：${result.error || '请稍后重试。'}`,
      dedupeKey: `subaccount-login-failed:${accountId}`,
    })
  }
}

export async function disconnectSubAccount(
  accountId: string,
  accounts: SubAccountItem[],
  actions: Actions,
  toast: ToastApi,
) {
  const account = accounts.find(item => item.id === accountId)
  if (!account) return

  const result = await window.subAccountAPI.disconnectAccount(SUB_ACCOUNT_WORKSPACE_ID, accountId)

  if (result.success) {
    actions.updateAccountStatus(accountId, 'idle')
    toast.info({
      title: '已断开连接',
      description: `小号“${account.name}”已断开。`,
      dedupeKey: `subaccount-disconnect:${accountId}`,
    })
  } else {
    toast.error({
      title: '断开失败',
      description: `小号“${account.name}”断开连接失败，请重试。`,
      dedupeKey: `subaccount-disconnect-failed:${accountId}`,
    })
  }
}

export async function clearSubAccountLoginState({
  accountId,
  accounts,
  toast,
  syncAccountsFromBackend,
}: {
  accountId: string
  accounts: SubAccountItem[]
  toast: ToastApi
  syncAccountsFromBackend: () => Promise<void>
}) {
  const account = accounts.find(item => item.id === accountId)
  if (!account) return

  const result = await window.subAccountAPI.clearStorageState(SUB_ACCOUNT_WORKSPACE_ID, accountId)

  if (result) {
    await syncAccountsFromBackend()
    toast.info({
      title: '登录态已清除',
      description: `“${account.name}”的已保存登录态已清除。`,
      dedupeKey: `subaccount-storage-cleared:${accountId}`,
    })
  } else {
    toast.error({
      title: '清除失败',
      description: '登录态清除失败，请重试。',
      dedupeKey: 'subaccount-storage-clear-failed',
    })
  }
}

export async function exportSubAccounts(toast: ToastApi) {
  const result = await window.subAccountAPI.exportAccounts(SUB_ACCOUNT_WORKSPACE_ID)
  if (result.success && result.data) {
    const blob = new Blob([result.data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sub-accounts-${new Date().toISOString().split('T')[0]}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success({
      title: '导出完成',
      description: '小号配置文件已导出。',
      dedupeKey: 'subaccount-export-success',
    })
  } else {
    toast.error({
      title: '导出失败',
      description: '小号配置导出失败，请稍后重试。',
      dedupeKey: 'subaccount-export-failed',
    })
  }
}

export async function importSubAccounts({
  event,
  toast,
  syncAccountsFromBackend,
}: {
  event: ChangeEvent<HTMLInputElement>
  toast: ToastApi
  syncAccountsFromBackend: () => Promise<void>
}) {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const result = await window.subAccountAPI.importAccounts(SUB_ACCOUNT_WORKSPACE_ID, text)
    if (result.success) {
      toast.success({
        title: '导入完成',
        description: `成功导入 ${result.added} 个小号。`,
        dedupeKey: 'subaccount-import-success',
      })
      await syncAccountsFromBackend()
    } else {
      toast.error({
        title: '导入失败',
        description: result.error || '导入失败，请检查文件内容。',
        dedupeKey: 'subaccount-import-failed',
      })
    }
  } catch {
    toast.error({
      title: '读取文件失败',
      description: '无法读取导入文件，请确认文件有效后重试。',
      dedupeKey: 'subaccount-import-read-failed',
    })
  }
  event.target.value = ''
}
