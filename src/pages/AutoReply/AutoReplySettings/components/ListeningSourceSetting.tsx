import { useMemo } from 'react'
import { abilities, listeningSources } from '@/abilities'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type AutoReplyConfig, useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'

type ListeningSource = AutoReplyConfig['entry']
const platformListeningSources: Partial<Record<LiveControlPlatform, ListeningSource[]>> =
  Object.fromEntries(
    Object.entries(abilities)
      .filter(([_, s]) => s.autoReply?.source?.length)
      .map(([p, s]) => [p, s.autoReply?.source]),
  )
const listeningSourceNameMap = Object.fromEntries(
  Object.entries(listeningSources).map(([k, v]) => [k, v.name]),
) as Record<ListeningSource, string>

export function ListeningSourceSetting() {
  const { updateGeneralSettings, config } = useAutoReplyConfig()
  const { toast } = useToast()
  const connectState = useCurrentLiveControl(context => context.connectState)
  const platform = connectState.platform as LiveControlPlatform
  const { entry: listeningSource } = config

  const listeningSourceTips = useMemo(() => {
    return listeningSources[listeningSource].tips
  }, [listeningSource])
  const availableSources = useMemo(() => {
    const sources = platformListeningSources[platform] ?? []
    return sources.includes(listeningSource) ? sources : [listeningSource, ...sources]
  }, [listeningSource, platform])

  const handleSourceChange = (value: ListeningSource) => {
    updateGeneralSettings({ entry: value })
    toast.success(`已切换至${listeningSourceNameMap[value]}监听`)
  }

  return (
    <div className="grid gap-3 md:grid-cols-[9rem_minmax(0,1fr)] md:items-center">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">监听来源</h3>
        <p className="text-xs text-muted-foreground">{listeningSourceTips}</p>
      </div>
      <Select
        value={listeningSource}
        onValueChange={value => handleSourceChange(value as ListeningSource)}
      >
        <SelectTrigger className="h-9">
          <SelectValue placeholder="选择监听来源" />
        </SelectTrigger>
        <SelectContent>
          {availableSources.map(source => (
            <SelectItem key={source} value={source}>
              {listeningSourceNameMap[source]}监听
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
