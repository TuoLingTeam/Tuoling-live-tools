import { useMemoizedFn } from 'ahooks'
import { GlobeIcon, Loader2, Monitor, Play, Square } from 'lucide-react'
import React, { useRef } from 'react'
import type { IpcChannels } from 'shared/electron-api.d.ts'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { OneClickStartButton } from '@/components/common/OneClickStartButton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ConnectState } from '@/config/platformConfig'
import { GATE_ACTIONS } from '@/domain/access/gateActions'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentAutoMessage } from '@/hooks/useAutoMessage'
import { useCurrentAutoPopUp } from '@/hooks/useAutoPopUp'
import { useAutoReply } from '@/hooks/useAutoReply'
import {
  useCurrentChromeConfig,
  useCurrentChromeConfigActions,
  useCurrentSelectedBrowser,
} from '@/hooks/useChromeConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useLiveStatsStore } from '@/hooks/useLiveStats'
import { useToast } from '@/hooks/useToast'
import { useGateStore } from '@/stores/gateStore'
import { getFullErrorInfo } from '@/utils/errorMessages'
import { generateTraceId } from '@/utils/traceId'
import PlatformSelect from './PlatformSelect'

// 使用共享类型定义
type ConnectResult = Awaited<ReturnType<IpcChannels[typeof IPC_CHANNELS.tasks.liveControl.connect]>>

const StatusAlert = React.memo(() => {
  const connectState = useCurrentLiveControl(state => state.connectState)

  // 连接中状态提示 - 已隐藏，保持业务逻辑不变
  if (connectState.status === 'connecting' || connectState.status === 'reconnecting') {
    return null
  }

  if (connectState.platform === 'wxchannel') {
    return (
      <Alert>
        <GlobeIcon className="h-4 w-4" />
        <AlertTitle>你选择了视频号平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>再连接中控台
            </li>
            <li>
              视频号助手无法<strong>一号多登</strong>，在别处登录视频号助手会
              <strong>中断连接</strong>!
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  if (connectState.platform === 'taobao') {
    return (
      <Alert>
        <GlobeIcon className="h-4 w-4" />
        <AlertTitle>你选择了淘宝平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>
              再连接中控台，因为进入淘宝中控台需要获取<strong>直播间ID</strong>
            </li>
            <li>
              目前淘宝会触发人机验证，所以将<strong>强制关闭无头模式</strong>
              ，除了登录和人机验证之外请尽量不要操作浏览器
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  return null
})

const StatusCard = React.memo(() => {
  const connectState = useCurrentLiveControl(context => context.connectState)
  const accountName = useCurrentLiveControl(context => context.accountName)
  const streamState = useCurrentLiveControl(context => context.streamState)

  return (
    <div data-tour="live-control">
      <StatusCardContent
        connectState={connectState}
        accountName={accountName}
        streamState={streamState}
      />
    </div>
  )
})

const StatusCardContent = React.memo(
  ({
    connectState,
    accountName,
    streamState,
  }: {
    connectState: ConnectState
    accountName: string | null
    streamState: string | null
  }) => {
    const currentAccountId = useAccounts(state => state.currentAccountId)
    const { isRunning: isAutoReplyRunning } = useAutoReply()
    const isAutoMessageRunning = useCurrentAutoMessage(context => context.isRunning)
    const isAutoPopUpRunning = useCurrentAutoPopUp(context => context.isRunning)
    const isLiveStatsRunning = useLiveStatsStore(
      state => state.contexts[currentAccountId]?.isListening ?? false,
    )

    // 获取连接阶段显示文本
    const getConnectingPhaseText = () => {
      if (connectState.status === 'reconnecting') {
        switch (connectState.phase) {
          case 'recovering':
            return '正在恢复连接...'
          case 'launching_browser':
            return '正在重启浏览器会话...'
          case 'verifying_session':
            return '正在恢复登录状态...'
          case 'streaming':
            return '正在恢复直播连接...'
          default:
            return '正在恢复连接...'
        }
      }

      switch (connectState.phase) {
        case 'preparing':
          return '准备连接...'
        case 'launching_browser':
          return '正在启动浏览器...'
        case 'waiting_for_login':
          return '等待扫码登录...'
        case 'verifying_session':
          return '正在验证登录状态...'
        case 'streaming':
          return '正在建立连接...'
        default:
          return '连接中...'
      }
    }

    // 【修复】获取直播状态显示文本
    const getStreamStateText = () => {
      switch (streamState) {
        case 'live':
          return '直播中'
        case 'offline':
          return '未开播'
        case 'ended':
          return '直播已结束'
        default:
          return '检测中...'
      }
    }

    const getStreamStateClassName = () => {
      switch (streamState) {
        case 'live':
          return 'text-green-600'
        case 'offline':
          return 'text-red-500'
        default:
          return 'text-muted-foreground'
      }
    }

    const statusText =
      connectState.status === 'connected'
        ? `已连接${accountName ? ` (${accountName})` : ''}`
        : connectState.status === 'connecting' || connectState.status === 'reconnecting'
          ? getConnectingPhaseText()
          : connectState.status === 'error'
            ? '连接失败'
            : '未连接'

    const isConnected = connectState.status === 'connected'
    const isConnecting =
      connectState.status === 'connecting' || connectState.status === 'reconnecting'
    const isAnyTaskRunning =
      isAutoReplyRunning || isAutoMessageRunning || isAutoPopUpRunning || isLiveStatsRunning

    const indicatorClassName = isConnecting
      ? 'border-primary/35 bg-primary/10 animate-pulse'
      : isConnected
        ? isAnyTaskRunning
          ? 'border-emerald-500/35 bg-emerald-500/10 animate-pulse'
          : 'border-emerald-500/35 bg-emerald-500/10'
        : 'border-primary/30 bg-primary/8'

    const indicatorIconClassName = isConnected ? 'h-7 w-7 text-emerald-500' : 'h-7 w-7 text-primary'

    return (
      <TooltipProvider>
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/50 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Monitor className="h-4 w-4 text-primary" />
                控制台状态
              </CardTitle>
              {/* 无头模式移到标题行右侧 */}
              <HeadlessSetting compact />
            </div>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              {/* 左侧状态显示 */}
              <div className="flex min-w-0 items-center gap-4">
                <div
                  className={`h-14 w-14 rounded-xl flex items-center justify-center border transition-all duration-300 ${indicatorClassName}`}
                >
                  {isConnecting ? (
                    <Loader2 className="h-7 w-7 text-primary animate-spin" />
                  ) : (
                    <Monitor className={indicatorIconClassName} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium transition-colors">{statusText}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {connectState.platform
                        ? `${getPlatformName(connectState.platform)}`
                        : '请选择平台并连接'}
                    </span>
                    {isConnected && (
                      <span>
                        · <span className={getStreamStateClassName()}>{getStreamStateText()}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 右侧操作区 */}
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end lg:gap-4">
                {/* 平台选择 */}
                <PlatformSelect />

                {/* 连接/断开按钮 */}
                <ConnectToLiveControl />

                {/* 一键开启任务 - 次级按钮 */}
                <OneClickStartButton variant="secondary" />
              </div>
            </div>

            {/* 平台提示 */}
            <div className="mt-4">
              <StatusAlert />
            </div>
          </CardContent>
        </Card>
      </TooltipProvider>
    )
  },
)

// 获取平台显示名称
const getPlatformName = (platform: string) => {
  const names: Record<string, string> = {
    douyin: '抖音小店',
    buyin: '巨量百应',
    eos: '抖音团购',
    xiaohongshu: '小红书千帆',
    pgy: '小红书蒲公英',
    wxchannel: '视频号',
    kuaishou: '快手小店',
    taobao: '淘宝',
    dev: '测试平台',
  }
  return names[platform] || platform
}

const ConnectToLiveControl = React.memo(() => {
  const connectState = useCurrentLiveControl(context => context.connectState)
  const browserPath = useCurrentChromeConfig(context => context.path)
  const storageState = useCurrentChromeConfig(context => context.storageState)
  const selectedBrowser = useCurrentSelectedBrowser()
  let headless = useCurrentChromeConfig(context => context.headless ?? false)
  const account = useAccounts(store => store.getCurrentAccount())
  const connectRequestInFlightRef = useRef(false)

  if (connectState.platform === 'taobao') {
    headless = false
  }

  const { toast } = useToast()
  const guardAction = useGateStore(s => s.guardAction)

  const connectLiveControl = useMemoizedFn(async () => {
    await guardAction(GATE_ACTIONS.CONNECT_LIVE_CONTROL, {
      requireSubscription: true,
      action: async () => {
        try {
          if (!account) {
            toast.error('没找到当前账号，请重新选择后再试')
            return
          }

          if (
            connectState.status === 'connecting' ||
            connectState.status === 'reconnecting' ||
            connectRequestInFlightRef.current
          ) {
            console.warn(`[conn][${account.id}] 重入拒绝：正在连接中`)
            toast.error('正在连接中控台，请稍等')
            return
          }

          const traceId = generateTraceId()
          console.log(`[conn][${account.id}][${traceId}] UI 点击连接`, {
            accountId: account.id,
            platform: connectState.platform,
            browser: selectedBrowser?.name || 'auto',
          })
          console.log('[State Machine] selectedPlatformId:', connectState.platform)
          console.log('[State Machine] headless config:', headless)
          console.log('[State Machine] selected browser:', selectedBrowser)
          console.log('[State Machine] 主进程状态机开始连接')

          connectRequestInFlightRef.current = true
          const result = (await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.connect, {
            headless,
            browserPath,
            storageState,
            platform: connectState.platform as LiveControlPlatform,
            account,
            traceId,
          })) as ConnectResult

          console.log('[Connect] IPC result:', result)

          if (result && !result.browserLaunched) {
            const friendlyError = getFullErrorInfo(result.error || '连接失败')
            toast.error({
              title: friendlyError.title,
              description: `${friendlyError.message}\n建议：${friendlyError.solution}`,
              dedupeKey: `live-control-connect-error:${account.id}`,
            })
          }
        } catch (error) {
          console.error('[State Machine] Connection failed:', error)
          const errorMessage = error instanceof Error ? error.message : '连接失败'
          console.log('[State Machine] Connection error:', errorMessage)
        } finally {
          connectRequestInFlightRef.current = false
        }
      },
    })
  })

  const disconnectLiveControl = useMemoizedFn(async () => {
    if (!account) {
      toast.error('没找到当前账号，请重新选择后再试')
      return
    }
    try {
      console.log('[State Machine] Starting disconnect for platform:', connectState.platform)
      await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, account.id)
      toast.success('已断开中控台连接')
    } catch (error) {
      console.error('[State Machine] Disconnect failed:', error)
      toast.error('断开连接失败，请重试')
    }
  })

  const handleButtonClick = useMemoizedFn(() => {
    if (connectState.status === 'connected') {
      disconnectLiveControl()
      return
    }
    if (connectState.status === 'connecting' || connectState.status === 'reconnecting') {
      return
    }
    connectLiveControl()
  })

  const getButtonText = () => {
    // 未添加账号时的提示
    if (!account) {
      return '请先添加直播账号'
    }
    switch (connectState.status) {
      case 'connecting':
        return '连接中...'
      case 'reconnecting':
        return '恢复中...'
      case 'connected':
        return '断开连接'
      case 'error':
        return '重试连接'
      default:
        return '连接直播中控台'
    }
  }

  const isConnected = connectState.status === 'connected'
  const isConnecting =
    connectState.status === 'connecting' || connectState.status === 'reconnecting'
  const hasAccount = !!account

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={handleButtonClick}
          disabled={isConnecting || !hasAccount}
          variant={isConnecting ? 'subtle' : isConnected ? 'secondary' : 'default'}
          className={`h-10 w-full px-4 text-sm font-medium transition-all sm:w-auto ${
            isConnecting
              ? 'border-amber-500/25 bg-amber-500/12 text-amber-100 hover:bg-amber-500/18'
              : ''
          } ${!hasAccount ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {isConnecting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : isConnected ? (
            <Square className="mr-1.5 h-4 w-4" />
          ) : (
            <Play className="mr-1.5 h-4 w-4" />
          )}
          {getButtonText()}
        </Button>
      </TooltipTrigger>
      {!hasAccount && (
        <TooltipContent side="bottom">
          <p>请先点击左侧「账号管理」添加直播账号</p>
        </TooltipContent>
      )}
    </Tooltip>
  )
})

const HeadlessSetting = React.memo(({ compact = false }: { compact?: boolean }) => {
  const headless = useCurrentChromeConfig(context => context.headless ?? false)
  const connectState = useCurrentLiveControl(context => context.connectState)
  const { setHeadless } = useCurrentChromeConfigActions()

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-xs text-muted-foreground whitespace-nowrap">无头</span>
            <Switch
              checked={headless}
              onCheckedChange={setHeadless}
              disabled={connectState.status !== 'disconnected'}
              className="scale-90"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>无头模式：后台运行浏览器，不显示窗口</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-muted/30 -my-1.5 cursor-pointer">
          <span className="text-sm text-muted-foreground whitespace-nowrap">无头模式</span>
          <Switch
            checked={headless}
            onCheckedChange={setHeadless}
            disabled={connectState.status !== 'disconnected'}
            className="scale-110"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>无头模式：后台运行浏览器，不显示窗口</p>
      </TooltipContent>
    </Tooltip>
  )
})

export { ConnectToLiveControl, HeadlessSetting, StatusAlert }
export default StatusCard
