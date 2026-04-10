import { useMemoizedFn } from 'ahooks'
import { Plus } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { normalizeAccountSelection, useAccounts } from '@/hooks/useAccounts'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { AccountLimitDialog } from './AccountLimitDialog'

export const AccountSwitcher = React.memo(() => {
  const accounts = useAccounts(state => state.accounts)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const addAccount = useAccounts(state => state.addAccount)
  const switchAccount = useAccounts(state => state.switchAccount)
  const connectState = useCurrentLiveControl(state => state.connectState)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)

  // 使用useMemo稳定账号列表
  const accountItems = useMemo(() => accounts.map(a => ({ id: a.id, name: a.name })), [accounts])

  // 确保Select的value永远合法
  const hasCurrent = accounts.some(a => a.id === currentAccountId)
  const normalizedAccountId = hasCurrent ? currentAccountId : (accounts[0]?.id ?? '')

  useEffect(() => {
    if (!accounts.length) return
    if (currentAccountId && hasCurrent) return
    const normalized = normalizeAccountSelection(accounts, currentAccountId, null)
    if (normalized.currentAccountId && normalized.currentAccountId !== currentAccountId) {
      switchAccount(normalized.currentAccountId)
    }
  }, [accounts, currentAccountId, hasCurrent, switchAccount])

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [isLimitDialogOpen, setIsLimitDialogOpen] = useState(false)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const { toast } = useToast()

  // 检查是否还可以添加账号
  const canAddAccount = useAccounts(state => state.canAddAccount)

  // 处理账号切换
  const handleAccountSwitch = useMemoizedFn(async (accountId: string) => {
    // 特殊值：添加账号
    if (accountId === '__add_account__') {
      const checkResult = canAddAccount()
      if (!checkResult.allowed) {
        // 达到上限，显示会员等级提示弹窗
        setIsLimitDialogOpen(true)
        return
      }
      // 可以添加，正常打开添加对话框
      setIsAddDialogOpen(true)
      return
    }

    // Guard: 如果已经是当前选中值，不执行切换
    if (accountId === currentAccountId) return

    // 执行切换
    switchAccount(accountId)
  })

  // 处理添加账号
  const handleAddAccount = useMemoizedFn(() => {
    const trimmedName = newAccountName.trim()
    if (!trimmedName) {
      toast.error('请输入账号名称')
      return
    }

    // 检查账号名称是否已存在
    if (accountItems.some(account => account.name === trimmedName)) {
      toast.error('账号名称已存在')
      return
    }

    // 调用添加账号并处理返回值
    const result = addAccount(trimmedName)
    if (result.success) {
      setIsAddDialogOpen(false)
      setNewAccountName('')
      toast.success({
        title: '账号已添加',
        description: `已添加直播账号“${trimmedName}”。`,
        dedupeKey: `account-added:${trimmedName}`,
      })
    } else {
      // 显示错误提示（包含套餐限制信息）
      toast.error({
        title: '添加账号失败',
        description: result.error || '添加账号失败，请稍后重试。',
        dedupeKey: 'account-add-failed',
      })
    }
  })

  // 判断是否有账号
  const hasAccounts = accounts.length > 0
  const selectedAccountName = accountItems.find(account => account.id === normalizedAccountId)?.name

  return (
    <div className="flex items-center gap-2">
      <Select
        disabled={connectState.status === 'connecting' || connectState.status === 'reconnecting'}
        value={normalizedAccountId}
        onValueChange={handleAccountSwitch}
        open={isSelectOpen}
        onOpenChange={setIsSelectOpen}
      >
        <SelectTrigger className="w-[11.25rem]" aria-label="选择直播账号">
          <SelectValue
            placeholder={!isAuthenticated ? '请先登录' : hasAccounts ? '选择账号' : '暂无账号'}
          >
            {selectedAccountName}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* 有账号时显示账号列表 */}
          {hasAccounts &&
            accountItems.map(account => {
              const isCurrent = normalizedAccountId === account.id
              return (
                <SelectItem key={account.id} value={account.id} className="group">
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex-1 truncate">{account.name}</span>
                    {isCurrent && (
                      <span
                        aria-hidden="true"
                        className="rounded bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary"
                      >
                        当前
                      </span>
                    )}
                  </div>
                </SelectItem>
              )
            })}

          {hasAccounts && <SelectSeparator />}

          {/* 未登录时显示禁用状态的添加账号 */}
          {!isAuthenticated ? (
            <SelectItem value="__add_account_disabled__" disabled>
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <span>添加账号（请先登录）</span>
              </div>
            </SelectItem>
          ) : (
            <SelectItem value="__add_account__" className="text-primary">
              <Plus className="h-4 w-4" />
              <span>添加账号…</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加新账号</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-account-name" className="text-sm font-medium text-foreground">
                账号名称
              </label>
              <Input
                id="new-account-name"
                placeholder="请输入账号名称"
                value={newAccountName}
                onChange={e => setNewAccountName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAddAccount}>确定</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 会员等级限制提示弹窗 */}
      <AccountLimitDialog
        isOpen={isLimitDialogOpen}
        onClose={() => setIsLimitDialogOpen(false)}
        onContinue={() => {
          // 用户选择继续添加，打开添加对话框
          setIsAddDialogOpen(true)
        }}
      />
    </div>
  )
})

AccountSwitcher.displayName = 'AccountSwitcher'
