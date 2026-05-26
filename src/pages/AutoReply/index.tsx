import { useMemoizedFn } from 'ahooks'
import { ArrowLeft, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { autoReplyPlatforms } from '@/abilities'
import { TaskControlButton } from '@/components/business/TaskControlButton'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAccounts } from '@/hooks/useAccounts'
import { useRequireAuthForAction } from '@/hooks/useAuth'
import { useAutoReply } from '@/hooks/useAutoReply'
import { useAutoStopOnGateLoss } from '@/hooks/useAutoStopOnGateLoss'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useLiveFeatureGate } from '@/hooks/useLiveFeatureGate'
import { useTaskManager } from '@/hooks/useTaskManager'
import { useToast } from '@/hooks/useToast'
import AutoReplyWorkbench from '@/pages/AutoReply/components/AutoReplyWorkbench'
import { stopAllLiveTasks } from '@/utils/stopAllLiveTasks'

const AUTO_REPLY_PLATFORM_LABELS: Partial<Record<LiveControlPlatform, string>> = {
  douyin: '抖音',
  buyin: '巨量百应',
  wxchannel: '视频号',
  xiaohongshu: '小红书',
  pgy: '小红书蒲公英',
  taobao: '淘宝',
  dev: '测试平台',
}

export function getAutoReplyUnavailableState(platform?: LiveControlPlatform | string | null): {
  title: string
  description: string
} {
  if (!platform) {
    return {
      title: '请先选择直播平台',
      description:
        '自动回复需要先在直播控制台选择平台并建立连接。选择支持的平台后，这里会显示评论监听和回复预览。',
    }
  }

  const selectedPlatform = AUTO_REPLY_PLATFORM_LABELS[platform as LiveControlPlatform] || platform
  return {
    title: '当前平台暂不支持自动回复',
    description: `当前选择的平台是“${selectedPlatform}”，暂不在自动回复支持范围内。请切换到支持的平台后再使用该功能。`,
  }
}

export default function AutoReply() {
  const { isRunning, isListening } = useAutoReply()
  const gate = useLiveFeatureGate()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const navigate = useNavigate()
  const { startTask, stopTask } = useTaskManager()
  const { toast } = useToast()

  // 自动停机：当 Gate 条件不满足时，自动停止任务
  // 注意：自动回复的实际运行状态是 isListening，不是 isRunning
  // isRunning 只是功能开关，isListening === 'listening' || 'waiting' 才是任务运行状态
  const taskIsRunning = isListening === 'listening' || isListening === 'waiting'

  useAutoStopOnGateLoss({
    gate,
    taskIsRunning,
    stopAll: useMemoizedFn(async reason => {
      console.log(
        `[autostop] Auto reply gate lost, reason: ${reason}, isListening: ${isListening}, isRunning: ${isRunning}`,
      )
      // stopAllLiveTasks 会显示 toast，useAutoStopOnGateLoss 也会显示 toast
      // 为了避免重复，这里传入 showToast=false，让 useAutoStopOnGateLoss 统一显示
      await stopAllLiveTasks(currentAccountId, reason, false)
    }),
  })

  // 引入登录检查 Hook
  const { requireAuthForAction } = useRequireAuthForAction('auto-reply')

  const handleAutoReplyToggle = useMemoizedFn(async () => {
    if (!taskIsRunning) {
      await requireAuthForAction(async () => {
        await startTask('autoReply')
      })
    } else {
      await stopTask('autoReply', 'manual')
      toast.success('自动回复已停止')
    }
  })

  const connectState = useCurrentLiveControl(context => context.connectState)
  const platform = connectState.platform
  if (!autoReplyPlatforms.includes(platform as LiveControlPlatform)) {
    const supportedPlatforms = autoReplyPlatforms
      .map(item => AUTO_REPLY_PLATFORM_LABELS[item] || item)
      .join('、')
    const unavailableState = getAutoReplyUnavailableState(platform)

    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex min-h-full flex-col gap-6 py-6">
            <div className="shrink-0">
              <Title title="自动回复" />
            </div>

            <Card className="overflow-hidden">
              <CardContent className="flex min-h-[18rem] flex-col items-start justify-center gap-5 p-8">
                <div className="space-y-2">
                  <div className="text-lg font-semibold text-foreground">
                    {unavailableState.title}
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    {unavailableState.description}
                  </p>
                  <p className="text-sm text-muted-foreground">支持的平台：{supportedPlatforms}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => navigate('/')} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    返回直播控制台
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/auto-reply/settings')}>
                    <Settings2 className="h-4 w-4" />
                    查看自动回复设置
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-start md:justify-between shrink-0">
        <div className="min-w-0 shrink-0">
          <Title title="自动回复" />
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 md:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('settings')}
            title="设置"
            className="h-8 text-sm"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>设置</span>
          </Button>
          <TaskControlButton
            isRunning={taskIsRunning}
            onStart={handleAutoReplyToggle}
            onStop={handleAutoReplyToggle}
            gate={gate}
            size="sm"
            startText="开始任务"
            stopText="停止任务"
          />
        </div>
      </div>

      <AutoReplyWorkbench />
    </div>
  )
}
