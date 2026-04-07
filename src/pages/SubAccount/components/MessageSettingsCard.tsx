import { BookOpen, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  SubAccountMessage,
  SubAccountPresetCategory,
  useSubAccountActions,
} from '@/hooks/useSubAccount'
import { MESSAGE_VARIABLES } from '../constants'

type MessageSettingsCardProps = {
  config: {
    scheduler: {
      interval: [number, number]
    }
    messages: SubAccountMessage[]
    random: boolean
    extraSpaces: boolean
    rotateAccounts: boolean
  }
  actions: ReturnType<typeof useSubAccountActions>
  showPresetLibrary: boolean
  setShowPresetLibrary: (value: boolean) => void
  presetCategories: SubAccountPresetCategory[]
  selectedPresetCategoryId: string | null
  setSelectedPresetCategoryId: (value: string | null) => void
  selectedPresetCategory: SubAccountPresetCategory | null
  updatePresetCategory: (
    categoryId: string,
    updater: (category: SubAccountPresetCategory) => SubAccountPresetCategory,
  ) => void
  handleAddPresetCategory: () => void
  handleLoadPreset: (categoryId: string) => void
  handleRemovePresetCategory: (categoryId: string) => void
  handleClearMessages: () => void
  onMessageTooLong: () => void
  onKeepLastMessage: () => void
}

export function MessageSettingsCard({
  config,
  actions,
  showPresetLibrary,
  setShowPresetLibrary,
  presetCategories,
  selectedPresetCategoryId,
  setSelectedPresetCategoryId,
  selectedPresetCategory,
  updatePresetCategory,
  handleAddPresetCategory,
  handleLoadPreset,
  handleRemovePresetCategory,
  handleClearMessages,
  onMessageTooLong,
  onKeepLastMessage,
}: MessageSettingsCardProps) {
  return (
    <Card>
      <CardHeader className="bg-muted/50 px-6 py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          消息设置
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">话术库</div>
            <div className="text-xs text-muted-foreground">快速加载预设互动话术</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPresetLibrary(!showPresetLibrary)}
          >
            <BookOpen className="h-4 w-4 mr-2" />
            {showPresetLibrary ? '关闭' : '加载话术'}
          </Button>
        </div>

        {showPresetLibrary && (
          <div className="p-3 border rounded-lg space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">自定义话术分类</div>
                <div className="text-xs text-muted-foreground">
                  分类名称、说明和分类内话术都可编辑
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddPresetCategory}>
                <Plus className="h-4 w-4 mr-1" />
                新增分类
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {presetCategories.map(category => (
                <Button
                  key={category.id}
                  variant={selectedPresetCategoryId === category.id ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => setSelectedPresetCategoryId(category.id)}
                >
                  {category.name}
                </Button>
              ))}
            </div>
            {selectedPresetCategory && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start gap-2">
                  <Input
                    value={selectedPresetCategory.name}
                    onChange={event =>
                      updatePresetCategory(selectedPresetCategory.id, category => ({
                        ...category,
                        name: event.target.value,
                      }))
                    }
                    placeholder="分类名称"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLoadPreset(selectedPresetCategory.id)}
                  >
                    加载该分类
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePresetCategory(selectedPresetCategory.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <Input
                  value={selectedPresetCategory.description}
                  onChange={event =>
                    updatePresetCategory(selectedPresetCategory.id, category => ({
                      ...category,
                      description: event.target.value,
                    }))
                  }
                  placeholder="分类说明"
                />
                <div className="space-y-2">
                  {selectedPresetCategory.messages.map((message, messageIndex) => (
                    <div key={message.id} className="flex items-center gap-2">
                      <Input
                        value={message.content}
                        onChange={event =>
                          updatePresetCategory(selectedPresetCategory.id, category => ({
                            ...category,
                            messages: category.messages.map(item =>
                              item.id === message.id
                                ? { ...item, content: event.target.value.slice(0, 50) }
                                : item,
                            ),
                          }))
                        }
                        placeholder={`分类话术 ${messageIndex + 1}`}
                        className="flex-1"
                        maxLength={50}
                      />
                      <Input
                        type="number"
                        value={message.weight}
                        onChange={event =>
                          updatePresetCategory(selectedPresetCategory.id, category => ({
                            ...category,
                            messages: category.messages.map(item =>
                              item.id === message.id
                                ? {
                                    ...item,
                                    weight: Math.max(1, Number(event.target.value) || 1),
                                  }
                                : item,
                            ),
                          }))
                        }
                        className="w-16"
                        min={1}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updatePresetCategory(selectedPresetCategory.id, category => ({
                            ...category,
                            messages:
                              category.messages.length <= 1
                                ? category.messages
                                : category.messages.filter(item => item.id !== message.id),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updatePresetCategory(selectedPresetCategory.id, category => ({
                        ...category,
                        messages: [
                          ...category.messages,
                          { id: crypto.randomUUID(), content: '', weight: 1 },
                        ],
                      }))
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    添加分类话术
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  提示：加载后会合并到现有消息列表中
                </div>
              </div>
            )}
          </div>
        )}

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-muted-foreground cursor-help underline">
                查看消息变量说明
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-1">
                {MESSAGE_VARIABLES.map(variable => (
                  <div key={variable.variable} className="text-xs">
                    <span className="font-mono text-primary">{variable.variable}</span>
                    <span className="text-muted-foreground ml-2">{variable.description}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-px bg-border" />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>消息列表 ({config.messages.length})</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="subtle"
                size="sm"
                onClick={handleClearMessages}
                disabled={config.messages.length <= 1}
                title="清空后保留一条空消息"
              >
                清空
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newMessage = {
                    id: crypto.randomUUID(),
                    content: '',
                    weight: 1,
                  }
                  actions.setMessages([...config.messages, newMessage])
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加
              </Button>
            </div>
          </div>
          {config.messages.map((message, index) => (
            <div key={message.id} className="flex items-center gap-2">
              <Input
                value={message.content}
                onChange={event => {
                  const value = event.target.value
                  if (value.length > 50) {
                    onMessageTooLong()
                    return
                  }
                  const nextMessages = [...config.messages]
                  nextMessages[index] = { ...message, content: value }
                  actions.setMessages(nextMessages)
                }}
                onBlur={event => {
                  const trimmed = event.target.value.trim()
                  if (trimmed !== event.target.value) {
                    const nextMessages = [...config.messages]
                    nextMessages[index] = { ...message, content: trimmed }
                    actions.setMessages(nextMessages)
                  }
                }}
                placeholder={`消息 ${index + 1}`}
                className="flex-1"
                maxLength={50}
              />
              <Input
                type="number"
                value={message.weight}
                onChange={event => {
                  const nextMessages = [...config.messages]
                  nextMessages[index] = {
                    ...message,
                    weight: Math.max(1, Number(event.target.value) || 1),
                  }
                  actions.setMessages(nextMessages)
                }}
                className="w-16"
                min={1}
                title="权重（数字越大被选中概率越高）"
              />
              <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                  if (config.messages.length <= 1) {
                    onKeepLastMessage()
                    return
                  }
                  actions.setMessages(config.messages.filter(item => item.id !== message.id))
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-2">
          <Label>发送间隔（秒）</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={config.scheduler.interval[0] / 1000}
              onChange={event =>
                actions.setScheduler({
                  interval: [Number(event.target.value) * 1000, config.scheduler.interval[1]],
                })
              }
              className="w-20"
              min={5}
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="number"
              value={config.scheduler.interval[1] / 1000}
              onChange={event =>
                actions.setScheduler({
                  interval: [config.scheduler.interval[0], Number(event.target.value) * 1000],
                })
              }
              className="w-20"
              min={5}
            />
            <span className="text-sm text-muted-foreground">秒</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">随机发送</div>
            <div className="text-xs text-muted-foreground">
              按权重随机选择消息发送（关闭则按顺序）
            </div>
          </div>
          <Switch checked={config.random} onCheckedChange={actions.setRandom} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">插入随机空格</div>
            <div className="text-xs text-muted-foreground">避免被平台检测为重复内容</div>
          </div>
          <Switch checked={config.extraSpaces} onCheckedChange={actions.setExtraSpaces} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">轮换账号</div>
            <div className="text-xs text-muted-foreground">
              按顺序轮换使用小号（关闭则随机选择）
            </div>
          </div>
          <Switch checked={config.rotateAccounts} onCheckedChange={actions.setRotateAccounts} />
        </div>
      </CardContent>
    </Card>
  )
}
