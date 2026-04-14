import { useId } from 'react'
import AIModelInfo from '@/components/ai-chat/AIModelInfo'
import { APIKeyDialog } from '@/components/ai-chat/APIKeyDialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAIChatStore } from '@/hooks/useAIChat'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

export function AIReplySetting() {
  const { config, updateAIReplySettings } = useAutoReplyConfig()
  const aiReplyEnabled = config.comment.aiReply.enable
  const autoSend = config.comment.aiReply.autoSend
  const autoSendScope = config.comment.aiReply.autoSendScope ?? 'safe-only'
  const useSharedConfig = config.comment.aiReply.useSharedConfig ?? false
  const mentionUser = config.comment.aiReply.mentionUser ?? false

  // 获取AI对话的配置用于显示
  const aiChatConfig = useAIChatStore(state => state.config)
  const aiChatProvider = aiChatConfig.provider
  const aiChatModel = aiChatConfig.model

  // 处理AI自动回复开关
  const handleAiReplyChange = (checked: boolean) => {
    updateAIReplySettings({ enable: checked })
  }

  const handleAutoSendChange = (checked: boolean) => {
    updateAIReplySettings({ autoSend: checked })
  }

  const handleAutoSendScopeChange = (value: 'all' | 'safe-only') => {
    updateAIReplySettings({ autoSendScope: value })
  }

  // 【P1-1 AI联动】处理使用AI对话配置开关
  const handleUseSharedConfigChange = (checked: boolean) => {
    updateAIReplySettings({ useSharedConfig: checked })
  }

  const aiReplyId = useId()
  const autoSendId = useId()
  const useSharedConfigId = useId()
  const mentionUserId = useId()

  return (
    <>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center space-x-2">
          <Switch id={aiReplyId} checked={aiReplyEnabled} onCheckedChange={handleAiReplyChange} />
          <Label htmlFor={aiReplyId}>启用AI自动回复</Label>
        </div>

        {/* 【P1-1 AI联动】使用AI对话配置开关 */}
        {aiReplyEnabled && (
          <div className="flex items-center space-x-2 pl-4 border-l-2 border-primary/20">
            <Switch
              id={useSharedConfigId}
              checked={useSharedConfig}
              onCheckedChange={handleUseSharedConfigChange}
            />
            <div className="flex flex-col">
              <Label htmlFor={useSharedConfigId}>使用AI对话的配置</Label>
              <span className="text-xs text-muted-foreground">
                {useSharedConfig
                  ? `当前使用：${aiChatProvider} / ${aiChatModel}`
                  : '使用自动回复的独立配置'}
              </span>
            </div>
          </div>
        )}

        {aiReplyEnabled && (
          <div className="flex items-center space-x-2 pl-4 border-l-2 border-primary/20">
            <Switch
              id={mentionUserId}
              checked={mentionUser}
              onCheckedChange={checked => updateAIReplySettings({ mentionUser: checked })}
            />
            <div className="flex flex-col">
              <Label htmlFor={mentionUserId}>回复前自动 @ 用户</Label>
              <span className="text-xs text-muted-foreground">
                开启后会在 AI 回复前拼接 `@昵称`；若同时开启“隐藏用户名”，则显示为 `@张***`
              </span>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center space-x-2">
            <Switch id={autoSendId} checked={autoSend} onCheckedChange={handleAutoSendChange} />
            <Label htmlFor={autoSendId}>自动发送</Label>
          </div>
          {autoSend && (
            <div className="mt-3 space-y-2 pl-4 border-l-2 border-primary/20">
              <div className="text-xs font-medium text-foreground">自动发送范围</div>
              <Select
                value={autoSendScope}
                onValueChange={value => handleAutoSendScopeChange(value as 'all' | 'safe-only')}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue placeholder="选择自动发送范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe-only">仅自动发送知识命中/安全兜底</SelectItem>
                  <SelectItem value="all">所有 AI 回复都自动发送</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                推荐先使用“仅自动发送知识命中/安全兜底”，普通闲聊 AI
                回复先走预览，确认稳定后再放开全自动。
              </p>
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2 pl-2">
            <p>
              请注意：开启自动发送后，符合当前发送范围的回复会自动发送到直播间，这可能会带来以下
              <strong>风险</strong>：
            </p>
            <ul className="list-disc pl-6 mt-1">
              <li>
                AI可能会生成<strong>不恰当或不相关</strong>的回复
              </li>
              <li>
                回复内容可能会<strong>违反平台规则</strong>
              </li>
              <li>可能会影响与观众的真实互动体验</li>
            </ul>
            <p className="font-medium mt-1">
              ※ 建议在开启自动发送前，先观察一段时间AI的回复质量。您也可以通过点击每条回复预览旁边的
              <strong>小飞机按钮</strong>来手动发送。
            </p>
          </div>
        </div>
      </div>
      {aiReplyEnabled && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">闲聊补充要求</div>
            <Textarea
              placeholder="补充你的闲聊回复风格，例如：更活泼一点，少一点带货感"
              value={config.comment.aiReply.prompt}
              onChange={e => updateAIReplySettings({ prompt: e.target.value })}
              className="min-h-[6rem]"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">商品补充要求</div>
            <Textarea
              placeholder="补充你的商品类回复风格，例如：更像口播，不要复述商品长标题"
              value={config.comment.aiReply.productPrompt ?? ''}
              onChange={e => updateAIReplySettings({ productPrompt: e.target.value })}
              className="min-h-[6rem]"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            系统已内置默认口播风格、商品类回复规则和平台合规限制；这里用于补充你的个性化要求，不会覆盖系统规则。
          </p>
          <div className="flex justify-between items-center space-x-2">
            <APIKeyDialog />
            <AIModelInfo />
          </div>
        </div>
      )}
    </>
  )
}
