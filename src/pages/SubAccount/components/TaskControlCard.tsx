import { FolderOpen, MessageSquare, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type BatchProgress = {
  current: number
  total: number
  completed: number
  failed: number
}

type EnterProgress = {
  current: number
  total: number
  completed: number
  failed: number
  accountId: string
  accountName: string
  success: boolean
  error?: string
}

type VerificationNotice = {
  accountId: string
  accountName?: string
  message: string
  timestamp: number
}

type TaskControlCardProps = {
  verificationNotice: VerificationNotice | null
  dismissVerificationNotice: () => void
  isRunning: boolean
  connectedCount: number
  enteredCount: number
  toggleGroupManager: () => void
  batchCount: number
  setBatchCount: (value: number) => void
  handleSendBatch: () => Promise<void>
  handleTaskButtonClick: () => Promise<void>
  liveRoomUrl: string
  isEnteringAll: boolean
  batchProgress: BatchProgress | null
  enterProgress: EnterProgress | null
}

export function TaskControlCard({
  verificationNotice,
  dismissVerificationNotice,
  isRunning,
  connectedCount,
  enteredCount,
  toggleGroupManager,
  batchCount,
  setBatchCount,
  handleSendBatch,
  handleTaskButtonClick,
  liveRoomUrl,
  isEnteringAll,
  batchProgress,
  enterProgress,
}: TaskControlCardProps) {
  return (
    <Card>
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          任务控制
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {verificationNotice && (
          <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium">
                  {verificationNotice.accountName || '小号'} 需要人工完成平台安全验证
                </p>
                <p>{verificationNotice.message}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={dismissVerificationNotice}>
                知道了
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-medium">{isRunning ? '正在运行' : '已停止'}</div>
              <div className="text-xs text-muted-foreground">
                {connectedCount} 个小号在线 · {enteredCount} 个已进目标直播间
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={toggleGroupManager}>
              <FolderOpen className="h-4 w-4 mr-2" />
              分组管理
            </Button>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                value={batchCount}
                onChange={e => setBatchCount(Math.max(1, Number(e.target.value)))}
                className="w-16 h-8 text-center"
                min={1}
                max={50}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSendBatch()}
                disabled={isRunning || enteredCount === 0 || !liveRoomUrl.trim() || isEnteringAll}
              >
                一键刷屏
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() => void handleTaskButtonClick()}
              variant={isRunning ? 'destructive' : 'default'}
              disabled={isEnteringAll}
            >
              {isRunning ? '停止任务' : '开始任务'}
            </Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          开始任务后，仅已进入目标直播间的小号会参与自动发言。
        </p>

        {batchProgress && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">批量发送进度</span>
              <span className="font-medium">
                {batchProgress.current} / {batchProgress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <Badge variant="success" className="font-medium">
                成功: {batchProgress.completed}
              </Badge>
              <Badge variant="destructive" className="font-medium">
                失败: {batchProgress.failed}
              </Badge>
              {batchProgress.current >= batchProgress.total && (
                <span className="text-primary ml-auto">发送完成</span>
              )}
            </div>
          </div>
        )}

        {enterProgress && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                全部进入进度
                {enterProgress.accountName ? ` · 当前 ${enterProgress.accountName}` : ''}
              </span>
              <span className="font-medium">
                {enterProgress.current} / {enterProgress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${enterProgress.total > 0 ? (enterProgress.current / enterProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <Badge variant="success" className="font-medium">
                成功: {enterProgress.completed}
              </Badge>
              <Badge variant="destructive" className="font-medium">
                失败: {enterProgress.failed}
              </Badge>
              {enterProgress.current >= enterProgress.total && (
                <span className="text-primary ml-auto">进入完成</span>
              )}
            </div>
            {enterProgress.error && (
              <div className="mt-2 text-xs text-destructive">{enterProgress.error}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
