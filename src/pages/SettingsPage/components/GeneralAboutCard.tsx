import { FileTextIcon, Info, Palette, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useDevMode } from '@/hooks/useDevMode'
import { type ThemeMode, themeConfig, useTheme } from '@/hooks/useTheme'
import { useToast } from '@/hooks/useToast'
import { useUpdateConfigStore, useUpdateStore } from '@/hooks/useUpdate'
import { version } from '../../../../package.json'
import { SettingRow } from './SettingRow'

export function GeneralAboutCard() {
  const [hideToTrayTipEnabled, setHideToTrayTipEnabled] = useState(true)
  const enableAutoCheckUpdate = useUpdateConfigStore(state => state.enableAutoCheckUpdate)
  const setEnableAutoCheckUpdate = useUpdateConfigStore(state => state.setEnableAutoCheckUpdate)
  const updateStatus = useUpdateStore.use.status()
  const checkUpdateManually = useUpdateStore.use.checkUpdateManually()
  const [isUpToDate, setIsUpToDate] = useState(false)
  const { toast } = useToast()
  const { enabled: devMode, setEnabled: setDevMode } = useDevMode()
  const { themeMode, resolvedTheme, setThemeMode } = useTheme()

  useEffect(() => {
    const loadSetting = async () => {
      const dismissed = await window.appAPI.getHideToTrayTipDismissed()
      setHideToTrayTipEnabled(!dismissed)
    }
    loadSetting()
  }, [])

  const handleToggleHideToTrayTip = async (enabled: boolean) => {
    setHideToTrayTipEnabled(enabled)
    await window.appAPI.setHideToTrayTipDismissed(!enabled)
  }

  const checkUpdate = async () => {
    const result = await checkUpdateManually()
    if (result) setIsUpToDate(result.upToDate)
  }

  const handleToggleDevMode = async (checked: boolean) => {
    try {
      setDevMode(checked)
      toast.info({
        title: checked ? '开发者模式已开启' : '开发者模式已关闭',
        description: checked ? '现在可以通过右键打开开发者工具。' : '已恢复普通使用模式。',
        dedupeKey: 'dev-mode-toggle',
      })
    } catch {
      toast.error({
        title: '切换失败',
        description: '开发者模式切换失败，请重试。',
        dedupeKey: 'dev-mode-toggle-failed',
      })
    }
  }

  const handleOpenLogFolder = () => window.appAPI.openLogFolder()

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          常规与关于
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* 外观设置分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Palette className="h-4 w-4 text-primary" />
            外观主题
          </div>

          <div className="pl-3">
            <SettingRow label="界面主题" description={themeConfig[resolvedTheme].description}>
              <div className="flex items-center gap-3">
                <div
                  className="h-8 w-8 rounded-full border border-border/70 shadow-sm"
                  style={{ background: themeConfig[resolvedTheme].color }}
                  aria-hidden="true"
                />
                <Select value={themeMode} onValueChange={value => setThemeMode(value as ThemeMode)}>
                  <SelectTrigger className="h-9 w-[12rem] bg-background">
                    <SelectValue placeholder="选择主题" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fashion">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border border-border/70"
                          style={{ background: themeConfig.fashion.color }}
                          aria-hidden="true"
                        />
                        <span>时尚主题</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="daylight">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border border-border/70"
                          style={{ background: themeConfig.daylight.color }}
                          aria-hidden="true"
                        />
                        <span>日间浅色</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="system">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full border border-border/70 bg-gradient-to-r from-[#FF6B35] to-[#FFEAD7]" />
                        <span>跟随系统</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SettingRow>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* 通知设置分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="h-4 w-1 rounded-full bg-primary" />
            通知设置
          </div>

          <div className="pl-3 space-y-3">
            <SettingRow label="最小化到托盘提示" description="关闭窗口时显示系统通知提醒">
              <Switch checked={hideToTrayTipEnabled} onCheckedChange={handleToggleHideToTrayTip} />
            </SettingRow>

            <SettingRow label="新版本提醒" description="有新版本时弹窗显示更新内容">
              <Switch checked={enableAutoCheckUpdate} onCheckedChange={setEnableAutoCheckUpdate} />
            </SettingRow>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-border" />

        {/* 软件更新分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="h-4 w-1 rounded-full bg-primary" />
            软件更新
          </div>

          <div className="pl-3">
            <div className="flex flex-col gap-4 rounded-lg bg-muted/30 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">当前版本</div>
                  <div className="text-sm text-muted-foreground">v{version}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 self-start md:self-auto"
                disabled={updateStatus === 'checking'}
                onClick={checkUpdate}
              >
                {updateStatus === 'checking' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {isUpToDate ? '已是最新' : '检查更新'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-border" />

        {/* 开发者工具分组 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="h-4 w-1 rounded-full bg-primary" />
            开发者工具
          </div>

          <div className="pl-3 space-y-3">
            <SettingRow label="运行日志" description="查看程序运行日志文件 main.log">
              <Button variant="outline" size="sm" className="h-9" onClick={handleOpenLogFolder}>
                <FileTextIcon className="mr-2 h-4 w-4" />
                打开日志
              </Button>
            </SettingRow>

            <SettingRow label="开发者模式" description="右键打开开发者工具，用于调试">
              <Switch checked={devMode} onCheckedChange={handleToggleDevMode} />
            </SettingRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
