import { Activity, Hash, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TaskControlButton } from '@/components/business/TaskControlButton'
import { GateButton } from '@/components/GateButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccounts } from '@/hooks/useAccounts'
import {
  getEffectiveAutoMessageContents,
  useAutoMessageActions,
  useCurrentAutoMessage,
} from '@/hooks/useAutoMessage'
import type { LiveFeatureGate } from '@/hooks/useLiveFeatureGate'
import { useToast } from '@/hooks/useToast'

interface TaskControlCardProps {
  isRunning: boolean
  gate: LiveFeatureGate
  onStartStop: () => void
}

export default function TaskControlCard({ isRunning, gate, onStartStop }: TaskControlCardProps) {
  // 一键刷屏相关状态
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const batchCount = useCurrentAutoMessage(ctx => ctx.batchCount ?? 5)
  const { setBatchCount } = useAutoMessageActions()
  const messages = useCurrentAutoMessage(ctx => ctx.config.messages)
  const accountId = useAccounts(s => s.currentAccountId)
  const { toast } = useToast()

  const mappedMessages = useMemo(() => getEffectiveAutoMessageContents(messages), [messages])

  const handleBatchSend = async () => {
    if (mappedMessages.length === 0) {
      toast.error('请至少配置一条非空消息')
      return
    }

    setIsBatchRunning(true)
    try {
      await window.autoMessageAPI.sendBatchMessages(accountId, mappedMessages, batchCount)
    } finally {
      setIsBatchRunning(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          任务控制
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl border ${isRunning ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-primary/30 bg-primary/6'}`}
            >
              {isRunning ? (
                <div className="h-4 w-4 rounded-full border-2 border-emerald-400 animate-pulse" />
              ) : (
                <Activity className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <div className="text-sm font-medium">{isRunning ? '任务运行中' : '任务已停止'}</div>
              <div className="text-xs text-muted-foreground">
                {isRunning ? '自动发言功能正在工作' : '点击开始任务启动自动发言'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 一键刷屏按钮 */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded-lg">
                      <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        type="number"
                        value={batchCount}
                        onChange={e => setBatchCount(+e.target.value)}
                        className="w-14 h-7 text-xs text-center border-0 bg-transparent p-0 focus-visible:ring-0"
                        min="1"
                        max="50"
                      />
                    </div>
                    <GateButton
                      gate={gate}
                      onClick={handleBatchSend}
                      disabled={isBatchRunning}
                      size="sm"
                      variant="outline"
                      className="h-9 px-3"
                    >
                      {isBatchRunning ? (
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <>
                          <Zap className="mr-1.5 h-3.5 w-3.5" />
                          一键刷屏
                        </>
                      )}
                    </GateButton>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs text-muted-foreground">连续发送多条评论，适用于活跃气氛</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 开始/停止任务按钮 */}
            <TaskControlButton
              isRunning={isRunning}
              onStart={onStartStop}
              onStop={onStartStop}
              gate={gate}
              size="sm"
              startText="开始任务"
              stopText="停止任务"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
