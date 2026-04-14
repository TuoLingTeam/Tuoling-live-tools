import { useAccounts } from '@/hooks/useAccounts'

export function getScopedAccountIdsForCleanup(): string[] {
  const { accounts, currentAccountId } = useAccounts.getState()
  const scopedIds = new Set<string>()

  for (const account of accounts) {
    if (account?.id) {
      scopedIds.add(account.id)
    }
  }

  if (currentAccountId) {
    scopedIds.add(currentAccountId)
  }

  return Array.from(scopedIds)
}

export async function stopRuntimeTasksForAccount(accountId: string): Promise<void> {
  try {
    await window.taskControlAPI.stopCommentListener(accountId)
  } catch (error) {
    console.log(`[AuthStore] 停止评论监听失败（可能未运行）: ${accountId}`, error)
  }

  try {
    await window.taskControlAPI.stopAutoMessage(accountId)
  } catch (error) {
    console.log(`[AuthStore] 停止自动发言失败（可能未运行）: ${accountId}`, error)
  }

  try {
    await window.taskControlAPI.stopAutoPopUp(accountId)
  } catch (error) {
    console.log(`[AuthStore] 停止自动弹窗失败（可能未运行）: ${accountId}`, error)
  }

  try {
    await window.liveControlAPI.disconnect(accountId)
  } catch (error) {
    console.log(`[AuthStore] 断开连接失败（可能未连接）: ${accountId}`, error)
  }
}

export async function stopRuntimeTasksForAllAccounts(reason: string): Promise<void> {
  const accountIds = getScopedAccountIdsForCleanup()
  if (accountIds.length === 0) {
    console.log(`[AuthStore] 跳过任务清理，未找到账号。reason=${reason}`)
    return
  }

  console.log(`[AuthStore] 正在停止账号任务。reason=${reason}, accounts=${accountIds.join(',')}`)
  for (const accountId of accountIds) {
    await stopRuntimeTasksForAccount(accountId)
  }
}
