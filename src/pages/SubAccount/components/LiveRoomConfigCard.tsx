import { Link2, MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type LiveRoomConfigCardProps = {
  liveRoomUrl: string
  setLiveRoomUrl: (value: string) => void
  fetchLiveRoomUrl: () => Promise<void>
  handleEnterAllLiveRoom: () => Promise<void>
  connectedCount: number
  isEnteringAll: boolean
}

export function LiveRoomConfigCard({
  liveRoomUrl,
  setLiveRoomUrl,
  fetchLiveRoomUrl,
  handleEnterAllLiveRoom,
  connectedCount,
  isEnteringAll,
}: LiveRoomConfigCardProps) {
  return (
    <Card>
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          直播间配置
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex flex-col gap-3">
          <Label htmlFor="liveRoomUrl" className="text-sm text-muted-foreground">
            直播间地址（小号将以观众身份进入此直播间发送弹幕）
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="liveRoomUrl"
              placeholder="https://live.douyin.com/xxxx 或 https://www.xiaohongshu.com/live/xxxx"
              value={liveRoomUrl}
              onChange={e => setLiveRoomUrl(e.target.value)}
              className="flex-1"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void fetchLiveRoomUrl()}
                    className="shrink-0"
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>自动获取主账号当前直播间链接</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleEnterAllLiveRoom()}
              disabled={connectedCount === 0 || !liveRoomUrl.trim() || isEnteringAll}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              全部进入
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            提示：点击 <Link2 className="h-3 w-3 inline" />{' '}
            按钮可自动获取主账号当前直播间链接，或手动粘贴直播间分享链接
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
