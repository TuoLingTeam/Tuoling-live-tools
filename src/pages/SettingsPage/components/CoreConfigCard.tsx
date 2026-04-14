import { useMemoizedFn } from 'ahooks'
import {
  CheckCircle2,
  EraserIcon,
  FolderSearchIcon,
  Globe,
  Loader2,
  RefreshCw,
  SearchIcon,
  ShieldAlert,
  TrashIcon,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import {
  AUTH_LAST_IDENTIFIER_KEY,
  AUTH_REMEMBER_ME_KEY,
  AUTH_ZUSTAND_PERSIST_KEY,
} from '@/constants/authStorageKeys'
import { useAccounts } from '@/hooks/useAccounts'
import {
  useCurrentChromeConfig,
  useCurrentChromeConfigActions,
  useCurrentSelectedBrowser,
} from '@/hooks/useChromeConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { useAuthStore } from '@/stores/authStore'
import { SettingRow } from './SettingRow'

export function CoreConfigCard() {
  const browsers = useCurrentChromeConfig(context => context.browsers)
  const selectedBrowserId = useCurrentChromeConfig(context => context.selectedBrowserId)
  const selectedBrowser = useCurrentSelectedBrowser()
  const { setPath, setStorageState, setBrowsers, setSelectedBrowser, updateBrowserStatus } =
    useCurrentChromeConfigActions()
  const [isRefreshingBrowsers, setIsRefreshingBrowsers] = useState(false)
  const [isTestingBrowser, setIsTestingBrowser] = useState(false)
  const [edgeFirst, setEdgeFirst] = useState(false)
  const { toast } = useToast()
  const edgeFirstId = useId()

  const getBrowserDetectErrorMessage = (error: unknown) => {
    const rawMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : ''

    if (rawMessage.includes('is not allowed')) {
      return '当前安装包缺少浏览器检测通道，请升级到最新版本或重新安装应用。'
    }

    if (rawMessage.includes('No handler registered')) {
      return '浏览器检测服务未完成初始化，请重启应用后重试。'
    }

    return '浏览器检测失败，请稍后重试。'
  }

  const refreshBrowsers = useMemoizedFn(async (silent = false) => {
    try {
      setIsRefreshingBrowsers(true)
      const detectedBrowsers = await window.chromeAPI.listBrowsers(edgeFirst)
      setBrowsers(detectedBrowsers)

      if (!silent) {
        toast.success({
          title: detectedBrowsers.length > 0 ? '浏览器列表已更新' : '未检测到浏览器',
          description:
            detectedBrowsers.length > 0
              ? '已更新可用浏览器列表，请选择要连接的浏览器。'
              : '未检测到可用浏览器，你也可以手动导入自定义浏览器。',
          dedupeKey: 'browser-list-refreshed',
        })
      }
    } catch (error) {
      console.error('[CoreConfigCard] Failed to refresh browser list:', error)
      if (!silent) {
        toast.error({
          title: '检测失败',
          description: getBrowserDetectErrorMessage(error),
          dedupeKey: 'browser-list-refresh-failed',
        })
      }
    } finally {
      setIsRefreshingBrowsers(false)
    }
  })

  useEffect(() => {
    if (browsers.length === 0) {
      void refreshBrowsers(true)
    }
  }, [browsers.length, refreshBrowsers])

  const handleSelectChrome = async () => {
    try {
      const p = await window.chromeAPI.selectPath()
      if (p) {
        setPath(p)
        toast.success({
          title: '浏览器路径已更新',
          description: '已保存浏览器可执行文件路径。',
          dedupeKey: 'chrome-path-selected',
        })
      }
    } catch {
      toast.error({
        title: '选择路径失败',
        description: '未能读取浏览器路径，请重试。',
        dedupeKey: 'chrome-path-select-failed',
      })
    }
  }

  const handleTestSelectedBrowser = async () => {
    if (!selectedBrowser) {
      toast.warning({
        title: '请先选择浏览器',
        description: '先从浏览器列表中选择一个浏览器，再进行测试。',
        dedupeKey: 'browser-test-missing-selection',
      })
      return
    }

    try {
      setIsTestingBrowser(true)
      const result = await window.chromeAPI.testBrowser(selectedBrowser.path)

      updateBrowserStatus(selectedBrowser.id, {
        status: result.success ? 'verified' : 'failed',
        lastError: result.success ? null : result.error || '浏览器启动失败',
      })

      if (result.success) {
        toast.success({
          title: '浏览器测试通过',
          description: `${selectedBrowser.name} 可以正常启动，可用于连接直播中控台。`,
          dedupeKey: `browser-test-success:${selectedBrowser.id}`,
        })
      } else {
        toast.error({
          title: '浏览器测试失败',
          description: result.error || '浏览器无法正常启动，请尝试切换其他浏览器。',
          dedupeKey: `browser-test-failed:${selectedBrowser.id}`,
        })
      }
    } catch {
      toast.error({
        title: '测试失败',
        description: '浏览器测试失败，请稍后重试。',
        dedupeKey: 'browser-test-error',
      })
    } finally {
      setIsTestingBrowser(false)
    }
  }

  const handleCookiesReset = () => {
    setStorageState('')
    toast.info({
      title: '登录状态已重置',
      description: '已清除当前账号的浏览器登录状态。',
      dedupeKey: 'chrome-storage-reset',
    })
  }

  const { accounts, removeAccount, currentAccountId } = useAccounts()
  const connectState = useCurrentLiveControl(context => context.connectState)
  const isConnected = connectState.status === 'connected'
  const currentAccount = accounts.find(acc => acc.id === currentAccountId)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const handleDeleteAccount = useMemoizedFn(async () => {
    if (isConnected) {
      await window.liveControlAPI.disconnect(currentAccountId)
    }
    removeAccount(currentAccountId)
    setIsDeleteDialogOpen(false)
    toast.info({
      title: '账号已删除',
      description: '当前直播账号已移除。',
      dedupeKey: `account-deleted:${currentAccountId}`,
    })
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          核心配置
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* 浏览器设置分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="h-4 w-1 rounded-full bg-primary" />
            浏览器设置
          </div>

          <div className="pl-3 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="default"
                size="sm"
                onClick={() => void refreshBrowsers()}
                disabled={isRefreshingBrowsers}
                className="h-9"
              >
                {isRefreshingBrowsers ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {isRefreshingBrowsers ? '检测中...' : '刷新列表'}
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={handleSelectChrome}>
                <FolderSearchIcon className="mr-2 h-4 w-4" />
                导入自定义浏览器
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={handleTestSelectedBrowser}
                disabled={!selectedBrowser || isTestingBrowser}
              >
                {isTestingBrowser ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <SearchIcon className="mr-2 h-4 w-4" />
                )}
                {isTestingBrowser ? '测试中...' : '测试当前浏览器'}
              </Button>
              <div className="flex items-center gap-2">
                <Switch id={edgeFirstId} checked={edgeFirst} onCheckedChange={setEdgeFirst} />
                <Label
                  htmlFor={edgeFirstId}
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  优先使用 Edge
                </Label>
              </div>
            </div>

            <div className="rounded-xl border bg-muted/20">
              <div className="border-b px-4 py-3">
                <div className="text-sm font-medium">浏览器选择</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  连接直播中控台时将优先使用这里选中的浏览器。
                </div>
              </div>

              {browsers.length > 0 ? (
                <RadioGroup
                  value={selectedBrowserId}
                  onValueChange={value => setSelectedBrowser(value)}
                  className="p-3"
                >
                  {browsers.map(browser => (
                    <label
                      key={browser.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/50"
                    >
                      <RadioGroupItem value={browser.id} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{browser.name}</span>
                          {browser.source === 'manual' && <Badge variant="outline">自定义</Badge>}
                          {browser.status === 'verified' && (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              已验证
                            </Badge>
                          )}
                          {browser.status === 'failed' && (
                            <Badge variant="destructive">
                              <TriangleAlert className="mr-1 h-3 w-3" />
                              启动失败
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {browser.path}
                        </div>
                        {browser.lastError && browser.status === 'failed' && (
                          <div className="mt-2 text-xs text-destructive">{browser.lastError}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  还没有检测到浏览器。你可以点击上方“刷新列表”，或者导入自定义浏览器。
                </div>
              )}
            </div>

            <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
              <div>推荐浏览器：Edge、Chrome</div>
              <div className="mt-1">
                也支持导入 Brave、360 极速浏览器、搜狗浏览器等 Chromium 内核浏览器。
              </div>
              {selectedBrowser && (
                <div className="mt-2 text-foreground">
                  当前默认浏览器：<span className="font-medium">{selectedBrowser.name}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-border" />

        {/* 账号管理分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="h-4 w-1 rounded-full bg-primary" />
            账号管理
          </div>

          <div className="pl-3 space-y-3">
            <SettingRow label="重置登录状态" description="清除已保存的登录信息，下次需重新登录">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    <EraserIcon className="mr-2 h-4 w-4" />
                    重置
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认重置登录状态？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将清除已保存的登录信息，下次启动需重新登录。此操作无法撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleCookiesReset}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      确认重置
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </SettingRow>

            <SettingRow label="清除本地数据" description="清除 token、记住登录等，登录框将为空">
              <ClearLocalLoginButton />
            </SettingRow>

            <SettingRow
              label="删除当前账号"
              description={currentAccount ? `当前账号：${currentAccount.name}` : '无账号'}
            >
              {isConnected ? (
                <Button variant="outline" size="sm" className="h-9" disabled>
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  请先断开连接
                </Button>
              ) : (
                <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9">
                      <TrashIcon className="mr-2 h-4 w-4" />
                      删除账号
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除该账号？</AlertDialogTitle>
                      <AlertDialogDescription>
                        账号删除后无法恢复，请确保该账号的任务已停止。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteAccount}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </SettingRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ClearLocalLoginButton() {
  const { toast } = useToast()
  const clearTokensAndUnauth = useAuthStore(s => s.clearTokensAndUnauth)
  const handleClear = async () => {
    try {
      if (window.ipcRenderer) {
        await window.appAPI.clearLocalLoginData()
      }
      localStorage.removeItem(AUTH_REMEMBER_ME_KEY)
      localStorage.removeItem(AUTH_LAST_IDENTIFIER_KEY)
      localStorage.removeItem(AUTH_ZUSTAND_PERSIST_KEY)
      clearTokensAndUnauth()
      toast.info({
        title: '本地登录数据已清除',
        description: '下次打开登录框时将不再自动填充登录信息。',
        dedupeKey: 'clear-local-login-data',
      })
    } catch (e) {
      console.error(e)
      toast.error({
        title: '清除失败',
        description: '本地登录数据清除失败，请重试。',
        dedupeKey: 'clear-local-login-data-failed',
      })
    }
  }
  return (
    <Button variant="outline" size="sm" className="h-9" onClick={handleClear}>
      <EraserIcon className="mr-2 h-4 w-4" />
      清除
    </Button>
  )
}
