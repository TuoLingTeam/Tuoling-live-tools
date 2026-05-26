import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

export function HideUsernameSetting() {
  const { config, updateGeneralSettings } = useAutoReplyConfig()
  const hideUserNameId = useId()

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <Label htmlFor={hideUserNameId}>隐藏用户名</Label>
        <p className="text-xs leading-5 text-muted-foreground">
          系统会将
          <span className="mx-1 rounded bg-muted px-1 font-medium">{'{用户名}'}</span>
          替换为实际用户名；开启后仅保留首字，例如张三 -&gt; 张***。
        </p>
      </div>
      <div className="flex items-center">
        <Switch
          id={hideUserNameId}
          checked={config.hideUsername}
          onCheckedChange={checked => updateGeneralSettings({ hideUsername: checked })}
        />
      </div>
    </div>
  )
}
