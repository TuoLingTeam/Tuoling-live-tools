import { useMemoizedFn } from 'ahooks'
import { CircleAlert, Loader2, MonitorUp, Plus } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { PLATFORM_CONFIG } from '@/config/platformConfig'
import {
  createBindingAccountId,
  normalizeAccountSelection,
  normalizePlatformAccountName,
  useAccounts,
} from '@/hooks/useAccounts'
import { useChromeConfigStore } from '@/hooks/useChromeConfig'
import { useCurrentLiveControl, useLiveControlStore } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { useAuthStore } from '@/stores/authStore'
import { generateTraceId } from '@/utils/traceId'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { AccountLimitDialog } from './AccountLimitDialog'

type BindingDraft = {
  accountId: string
  platform: LiveControlPlatform
  platformName: string
  status: 'connecting' | 'error'
  error?: string
}

const bindablePlatforms = Object.entries(PLATFORM_CONFIG) as Array<
  [LiveControlPlatform, { name: string }]
>

export const AccountSwitcher = React.memo(() => {
  const accounts = useAccounts(state => state.accounts)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const bindPlatformAccountName = useAccounts(state => state.bindPlatformAccountName)
  const cancelAccountBinding = useAccounts(state => state.cancelAccountBinding)
  const startAccountBinding = useAccounts(state => state.startAccountBinding)
  const switchAccount = useAccounts(state => state.switchAccount)
  const connectState = useCurrentLiveControl(state => state.connectState)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const browserPath = useChromeConfigStore(state => state.contexts[currentAccountId]?.path ?? '')
  const { toast } = useToast()

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

  const [isLimitDialogOpen, setIsLimitDialogOpen] = useState(false)
  const [isBindDialogOpen, setIsBindDialogOpen] = useState(false)
  const [bindingDraft, setBindingDraft] = useState<BindingDraft | null>(null)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const activeBindingIdsRef = React.useRef(new Set<string>())

  // 检查是否还可以添加账号
  const canAddAccount = useAccounts(state => state.canAddAccount)

  const bindingConnectState = useLiveControlStore(state =>
    bindingDraft ? (state.contexts[bindingDraft.accountId]?.connectState ?? null) : null,
  )

  const openBindDialog = useMemoizedFn(() => {
    setBindingDraft(null)
    setIsBindDialogOpen(true)
  })

  const cancelBinding = useMemoizedFn(() => {
    const draftId = bindingDraft?.accountId
    setBindingDraft(null)
    setIsBindDialogOpen(false)

    if (draftId) {
      activeBindingIdsRef.current.delete(draftId)
      cancelAccountBinding(draftId)
      void window.liveControlAPI.disconnect(draftId).catch(error => {
        console.warn('[account-bind] 取消绑定时清理会话失败:', error)
      })
    }
  })

  const finishBindingFromAccountName = useMemoizedFn(
    (accountId: string, accountName: string | null | undefined, platform: LiveControlPlatform) => {
      const platformAccountName = normalizePlatformAccountName(accountName)
      if (!platformAccountName) {
        return false
      }

      const bindResult = bindPlatformAccountName(accountId, platformAccountName, platform, {
        allowInactiveBinding: true,
      })
      useLiveControlStore.getState().setAccountName(accountId, platformAccountName)

      if (bindResult.duplicateAccountId) {
        activeBindingIdsRef.current.delete(accountId)
        void window.liveControlAPI.disconnect(accountId).catch(error => {
          console.warn('[account-bind] 清理重复绑定会话失败:', error)
        })
        setBindingDraft(null)
        setIsBindDialogOpen(false)
        toast.warning({
          title: '账号已绑定',
          description: `“${bindResult.nextName || platformAccountName}”已在账号列表中，已切换到该账号。`,
          dedupeKey: `account-platform-name-duplicate:${accountId}:${platformAccountName}`,
        })
        return true
      }

      if (bindResult.created) {
        activeBindingIdsRef.current.delete(accountId)
        void window.liveControlAPI.disconnect(accountId).catch(error => {
          console.warn('[account-bind] 绑定成功后清理临时会话失败:', error)
        })
        setBindingDraft(null)
        setIsBindDialogOpen(false)
        toast.success({
          title: '账号已绑定',
          description: `已添加直播账号“${bindResult.nextName || platformAccountName}”。`,
          dedupeKey: `account-platform-name-created:${accountId}:${platformAccountName}`,
        })
        return true
      }

      const boundAccount = useAccounts.getState().accounts.find(account => account.id === accountId)
      if (boundAccount?.name === platformAccountName) {
        activeBindingIdsRef.current.delete(accountId)
        void window.liveControlAPI.disconnect(accountId).catch(error => {
          console.warn('[account-bind] 绑定成功后清理临时会话失败:', error)
        })
        setBindingDraft(null)
        setIsBindDialogOpen(false)
        return true
      }

      return false
    },
  )

  const handleBindDialogOpenChange = useMemoizedFn((open: boolean) => {
    if (open) {
      setIsBindDialogOpen(true)
      return
    }

    if (bindingDraft?.status === 'connecting') {
      cancelBinding()
      return
    }

    setIsBindDialogOpen(false)
    setBindingDraft(null)
  })

  const startBinding = useMemoizedFn(
    async (platform: LiveControlPlatform, platformName: string) => {
      const checkResult = canAddAccount()
      if (!checkResult.allowed) {
        setIsLimitDialogOpen(true)
        setIsBindDialogOpen(false)
        return
      }

      if (bindingDraft?.accountId) {
        activeBindingIdsRef.current.delete(bindingDraft.accountId)
        cancelAccountBinding(bindingDraft.accountId)
        void window.liveControlAPI.disconnect(bindingDraft.accountId).catch(error => {
          console.warn('[account-bind] 重试绑定时清理旧会话失败:', error)
        })
      }

      const accountId = createBindingAccountId()
      const traceId = generateTraceId()
      activeBindingIdsRef.current.add(accountId)
      startAccountBinding(accountId)
      useLiveControlStore.getState().setConnectState(accountId, {
        platform,
        status: 'connecting',
        phase: 'preparing',
        error: null,
        session: null,
        lastVerifiedAt: null,
      })
      setBindingDraft({
        accountId,
        platform,
        platformName,
        status: 'connecting',
      })

      try {
        const result = await window.liveControlAPI.connect({
          browserPath,
          headless: false,
          platform,
          account: {
            id: accountId,
            name: `${platformName}绑定中`,
            platform,
          },
          traceId,
        })

        if (!result.browserLaunched) {
          activeBindingIdsRef.current.delete(accountId)
          cancelAccountBinding(accountId)
          setBindingDraft(current =>
            current?.accountId === accountId
              ? {
                  ...current,
                  status: 'error',
                  error: result.error || '浏览器启动失败，请稍后重试。',
                }
              : current,
          )
          return
        }

        if (!activeBindingIdsRef.current.has(accountId)) {
          return
        }

        if ('accountName' in result && !normalizePlatformAccountName(result.accountName)) {
          activeBindingIdsRef.current.delete(accountId)
          cancelAccountBinding(accountId)
          void window.liveControlAPI.disconnect(accountId).catch(error => {
            console.warn('[account-bind] 未识别账号名后清理会话失败:', error)
          })
          setBindingDraft(current =>
            current?.accountId === accountId
              ? {
                  ...current,
                  status: 'error',
                  error: '已连接平台，但没有识别到账号名称，请重试。',
                }
              : current,
          )
          return
        }

        if (result.accountName) {
          finishBindingFromAccountName(accountId, result.accountName, result.platform ?? platform)
        }
      } catch (error) {
        activeBindingIdsRef.current.delete(accountId)
        cancelAccountBinding(accountId)
        setBindingDraft(current =>
          current?.accountId === accountId
            ? {
                ...current,
                status: 'error',
                error: error instanceof Error ? error.message : '绑定失败，请稍后重试。',
              }
            : current,
        )
      }
    },
  )

  useEffect(() => {
    if (!bindingDraft) return

    const handleBindingFinished = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId?: string }>).detail
      if (detail?.accountId !== bindingDraft.accountId) return

      activeBindingIdsRef.current.delete(bindingDraft.accountId)
      setBindingDraft(null)
      setIsBindDialogOpen(false)
    }

    window.addEventListener('account-bind-finished', handleBindingFinished)
    return () => window.removeEventListener('account-bind-finished', handleBindingFinished)
  }, [bindingDraft])

  useEffect(() => {
    if (!bindingDraft || !bindingConnectState) return

    if (bindingConnectState.status === 'error') {
      setBindingDraft(current =>
        current?.accountId === bindingDraft.accountId
          ? {
              ...current,
              status: 'error',
              error: bindingConnectState.error || '绑定失败，请稍后重试。',
            }
          : current,
      )
    }
  }, [bindingConnectState, bindingDraft])

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
      openBindDialog()
      return
    }

    // Guard: 如果已经是当前选中值，不执行切换
    if (accountId === currentAccountId) return

    // 执行切换
    switchAccount(accountId)
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
                <span>添加直播账号（请先登录）</span>
              </div>
            </SelectItem>
          ) : (
            <SelectItem value="__add_account__" className="text-primary">
              <Plus className="h-4 w-4" />
              <span>添加直播账号</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      <Dialog open={isBindDialogOpen} onOpenChange={handleBindDialogOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加直播账号</DialogTitle>
            <DialogDescription>
              选择平台后会打开浏览器，登录成功后自动绑定平台账号名称。
            </DialogDescription>
          </DialogHeader>

          {!bindingDraft ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {bindablePlatforms.map(([platform, config]) => (
                <Button
                  key={platform}
                  type="button"
                  variant="outline"
                  className="h-12 justify-start"
                  onClick={() => startBinding(platform, config.name)}
                >
                  <MonitorUp className="h-4 w-4" />
                  {config.name}
                </Button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                {bindingDraft.status === 'error' ? (
                  <CircleAlert className="mt-0.5 h-5 w-5 text-destructive" />
                ) : (
                  <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" />
                )}
                <div className="min-w-0 space-y-1">
                  <div className="font-medium text-sm">{bindingDraft.platformName}</div>
                  <div className="text-sm text-muted-foreground">
                    {bindingDraft.status === 'error'
                      ? bindingDraft.error || '绑定失败，请重试。'
                      : '请在弹出的浏览器中完成登录，系统识别账号后会自动添加。'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {bindingDraft && (
            <DialogFooter>
              <Button variant="outline" onClick={cancelBinding}>
                {bindingDraft.status === 'error' ? '关闭' : '取消绑定'}
              </Button>
              {bindingDraft.status === 'error' && (
                <Button
                  onClick={() => startBinding(bindingDraft.platform, bindingDraft.platformName)}
                >
                  重试
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* 会员等级限制提示弹窗 */}
      <AccountLimitDialog isOpen={isLimitDialogOpen} onClose={() => setIsLimitDialogOpen(false)} />
    </div>
  )
})

AccountSwitcher.displayName = 'AccountSwitcher'
