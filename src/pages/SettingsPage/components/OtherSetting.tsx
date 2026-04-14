import {
  CloudIcon,
  ExternalLinkIcon,
  FileTextIcon,
  KeyRound,
  LogOutIcon,
  RefreshCwIcon,
  Ticket,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { SetPasswordDialog } from '@/components/auth/SetPasswordDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  AUTH_LAST_IDENTIFIER_KEY,
  AUTH_REMEMBER_ME_KEY,
  AUTH_ZUSTAND_PERSIST_KEY,
} from '@/constants/authStorageKeys'
import { useToast } from '@/hooks/useToast'
import { type RedeemGiftCardResponse, redeemGiftCard } from '@/services/apiClient'
import { configSyncService } from '@/services/configSyncService'
import { useAuthStore } from '@/stores/authStore'

interface GiftCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function GiftCardDialog({ open, onOpenChange }: GiftCardDialogProps) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RedeemGiftCardResponse | null>(null)
  const { toast } = useToast()

  const handleRedeem = async () => {
    if (!code.trim()) {
      toast.warning({
        title: '请输入兑换码',
        description: '填写有效兑换码后才能继续兑换。',
        dedupeKey: 'gift-card-empty',
      })
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const apiResult = await redeemGiftCard(code.trim())
      if (apiResult.ok && apiResult.data) {
        setResult(apiResult.data)
        if (apiResult.data.success) {
          toast.success({
            title: '兑换成功',
            description: '会员权益已到账，正在同步最新状态。',
            dedupeKey: 'gift-card-redeem-success',
          })
          // 【修复】添加 await 确保状态刷新完成
          await useAuthStore.getState().refreshUserStatus()
          console.log('[GiftCard] User status refreshed after redeem')
        }
      } else {
        setResult({
          success: false,
          message: apiResult.ok ? '兑换失败' : apiResult.error?.message || '网络错误，请稍后重试',
        })
      }
    } catch (_error) {
      setResult({ success: false, message: '兑换失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            礼品卡兑换
          </DialogTitle>
          <DialogDescription>
            请输入礼品卡兑换码，兑换码通常为 XXXX-XXXX-XXXX 格式
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="gift-card-code">兑换码</Label>
            <Input
              id="gift-card-code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-1234-EFGH"
              className="font-mono text-lg tracking-wider"
              maxLength={14}
            />
          </div>

          {result && (
            <div
              className={`rounded-lg border p-3 ${
                result.success
                  ? 'border-emerald-500/25 bg-emerald-500/10'
                  : 'border-destructive/25 bg-destructive/10'
              }`}
            >
              {result.success ? (
                <div className="space-y-1">
                  <p className="font-medium text-emerald-100">兑换成功</p>
                  {result.data?.membershipType && (
                    <p className="text-sm text-emerald-100/85">
                      已开通 {result.data.membershipType === 'pro' ? '专业版' : '试用'} 会员
                      {result.data.membershipDays ? `（${result.data.membershipDays} 天）` : ''}
                      {result.data.newExpiryDate
                        ? `，有效期至 ${new Date(result.data.newExpiryDate).toLocaleDateString()}`
                        : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-red-100">{result.message}</p>
              )}
            </div>
          )}

          <Button onClick={handleRedeem} disabled={loading || !code.trim()} className="w-full">
            {loading ? '兑换中...' : '立即兑换'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function OtherSetting() {
  const [hideToTrayTipEnabled, setHideToTrayTipEnabled] = useState(true)
  const [giftCardDialogOpen, setGiftCardDialogOpen] = useState(false)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const { toast } = useToast()
  const clearTokensAndUnauth = useAuthStore(s => s.clearTokensAndUnauth)
  const userStatus = useAuthStore(s => s.userStatus)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const hasPassword = userStatus?.has_password !== false

  // 加载设置
  useEffect(() => {
    const loadSetting = async () => {
      const dismissed = await window.appAPI.getHideToTrayTipDismissed()
      // dismissed=true 表示已关闭提示，所以 enabled = !dismissed
      setHideToTrayTipEnabled(!dismissed)
    }
    loadSetting()
  }, [])

  // 保存设置
  const handleToggleHideToTrayTip = async (enabled: boolean) => {
    setHideToTrayTipEnabled(enabled)
    await window.appAPI.setHideToTrayTipDismissed(!enabled)
  }

  const handleOpenLogFolder = async () => {
    await window.appAPI.openLogFolder()
  }

  const handleOpenWebsite = async () => {
    await window.appAPI.openExternal('https://xiuer.work')
  }

  const handleOpenSupport = async () => {
    await window.appAPI.openExternal('mailto:support@xiuer.work')
  }

  const handleSyncToCloud = async () => {
    setSyncLoading(true)
    try {
      const result = await configSyncService.syncToCloud()
      if (result.success) {
        toast.success({
          title: '同步成功',
          description: '配置已上传到云端，可在其他设备上恢复。',
          dedupeKey: 'sync-to-cloud-success',
        })
      } else {
        toast.error({
          title: '同步失败',
          description: result.error || '网络错误，请稍后重试',
          dedupeKey: 'sync-to-cloud-failed',
        })
      }
    } catch (_err) {
      toast.error({
        title: '同步失败',
        description: '发生未知错误，请稍后重试',
        dedupeKey: 'sync-to-cloud-error',
      })
    } finally {
      setSyncLoading(false)
    }
  }

  const handleLoadFromCloud = async () => {
    setSyncLoading(true)
    try {
      const result = await configSyncService.loadFromCloud()
      if (result.success) {
        toast.success({
          title: '恢复成功',
          description: '已从云端恢复配置数据。',
          dedupeKey: 'load-from-cloud-success',
        })
      } else {
        toast.error({
          title: '恢复失败',
          description: result.error || '网络错误，请稍后重试',
          dedupeKey: 'load-from-cloud-failed',
        })
      }
    } catch (_err) {
      toast.error({
        title: '恢复失败',
        description: '发生未知错误，请稍后重试',
        dedupeKey: 'load-from-cloud-error',
      })
    } finally {
      setSyncLoading(false)
    }
  }

  const handleClearLocalLoginData = async () => {
    try {
      await window.appAPI.clearLocalLoginData()
      localStorage.removeItem(AUTH_REMEMBER_ME_KEY)
      localStorage.removeItem(AUTH_LAST_IDENTIFIER_KEY)
      localStorage.removeItem(AUTH_ZUSTAND_PERSIST_KEY)
      clearTokensAndUnauth()
      toast.info({
        title: '本地登录数据已清除',
        description: '下次打开登录框时将显示为空。',
        dedupeKey: 'clear-local-login-data',
      })
    } catch (e) {
      console.error('Clear local login data failed:', e)
      toast.error({
        title: '清除失败',
        description: '本地登录数据清除失败，请重试。',
        dedupeKey: 'clear-local-login-data-failed',
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>其他设置</CardTitle>
        <CardDescription>更多功能与信息</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>关闭时最小化到托盘提示</Label>
              <p className="text-sm text-muted-foreground">
                关闭窗口时显示系统通知，提醒应用仍在后台运行
              </p>
            </div>
            <Switch checked={hideToTrayTipEnabled} onCheckedChange={handleToggleHideToTrayTip} />
          </div>

          {isAuthenticated && (
            <>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium leading-none">云端同步</h4>
                  <p className="text-sm text-muted-foreground">
                    将配置数据同步到云端，换设备登录后可自动恢复
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleSyncToCloud}
                    disabled={syncLoading}
                  >
                    <CloudIcon className="h-4 w-4" />
                    {syncLoading ? '同步中...' : '上传配置'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleLoadFromCloud}
                    disabled={syncLoading}
                  >
                    <RefreshCwIcon className="h-4 w-4" />
                    {syncLoading ? '恢复中...' : '恢复配置'}
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium leading-none">登录密码</h4>
                  <p className="text-sm text-muted-foreground">
                    {hasPassword
                      ? '已设置密码，可用手机号 + 密码直接登录'
                      : '尚未设置密码，设置后可免验证码登录'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setPasswordDialogOpen(true)}
                >
                  <KeyRound className="h-4 w-4" />
                  {hasPassword ? '修改密码' : '设置密码'}
                </Button>
              </div>
            </>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium leading-none">清除本地登录数据</h4>
              <p className="text-sm text-muted-foreground">
                清除 token、记住登录状态与上次账号，不影响其他业务数据；下次启动登录框将为空
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleClearLocalLoginData}
            >
              <LogOutIcon className="h-4 w-4" />
              清除本地登录数据
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium leading-none">运行日志</h4>
              <p className="text-sm text-muted-foreground">查看程序运行日志文件 main.log</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleOpenLogFolder}>
              <FileTextIcon className="h-4 w-4" />
              打开日志文件夹
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium leading-none">礼品卡兑换</h4>
              <p className="text-sm text-muted-foreground">输入兑换码充值余额或开通会员</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setGiftCardDialogOpen(true)}
            >
              <Ticket className="h-4 w-4" />
              兑换礼品卡
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-sm font-medium leading-none">产品信息</h4>
              <p className="text-sm text-muted-foreground">了解更多产品相关内容</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleOpenWebsite}>
                官方网站
                <ExternalLinkIcon className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleOpenSupport}>
                技术支持
                <ExternalLinkIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      <GiftCardDialog open={giftCardDialogOpen} onOpenChange={setGiftCardDialogOpen} />
      <SetPasswordDialog
        isOpen={passwordDialogOpen}
        onClose={() => {
          setPasswordDialogOpen(false)
          useAuthStore.getState().refreshUserStatus()
        }}
        mode={hasPassword ? 'change' : 'set'}
      />
    </Card>
  )
}
