import { useId, useMemo } from 'react'
import ValidatedNumberInput from '@/components/common/ValidateNumberInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { createWebSocketToken, useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

export function WebSocketSetting() {
  const { config, updateWSConfig } = useAutoReplyConfig()
  const websocketId = useId()
  const websocketUrl = useMemo(() => {
    const port = config.ws?.port ?? 12354
    const token = config.ws?.token ?? ''
    return `ws://127.0.0.1:${port}?token=${token}`
  }, [config.ws?.port, config.ws?.token])

  return (
    <div className="flex flex-col space-y-1">
      <div className="flex justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id={websocketId}
            checked={!!config.ws?.enable}
            onCheckedChange={checked => updateWSConfig({ enable: checked })}
          />
          <Label htmlFor={websocketId}>启用 WebSocket 服务</Label>
        </div>
        <div className="flex space-x-1 items-center">
          <Label>端口号：</Label>
          <ValidatedNumberInput
            disabled={!config.ws?.enable}
            className="w-24"
            type="number"
            placeholder="12354"
            min={2000}
            max={65535}
            value={config.ws?.port ?? 12354}
            onCommit={value => updateWSConfig({ port: value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={websocketUrl}
          aria-label="WebSocket 连接地址"
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => updateWSConfig({ token: createWebSocketToken() })}
        >
          刷新令牌
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        启用时，点击「开始监听」按钮后将同步启动本地 WebSocket
        服务端，当有新的评论信息时会同步向客户端发送 JSON 格式的信息。
        <br />
        请使用上方地址连接，服务仅监听
        <span className="border p-0.5 px-1 rounded-md mx-1">127.0.0.1</span>
        并要求携带 token；也支持连接后首条消息发送
        <span className="border p-0.5 px-1 rounded-md mx-1">
          {'{"type":"auth","token":"..." }'}
        </span>
      </p>
    </div>
  )
}
