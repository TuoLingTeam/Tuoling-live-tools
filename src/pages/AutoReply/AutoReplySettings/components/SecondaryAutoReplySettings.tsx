import { type ReactNode, useMemo } from 'react'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { BlocklistManager } from './BlocklistManager'
import { CompassSetting } from './CompassSetting'
import { HideUsernameSetting } from './HideUsernameSetting'
import { ListeningSourceSetting } from './ListeningSourceSetting'
import { WechatChannelSetting } from './WechatChannelSetting'

export function SecondaryAutoReplySettings() {
  const { config } = useAutoReplyConfig()
  const extraSetting = useMemo(() => {
    switch (config.entry) {
      case 'compass':
        return <CompassSetting />
      case 'wechat-channel':
        return <WechatChannelSetting />
      default:
        return null
    }
  }, [config.entry])

  return (
    <section className="grid gap-3 xl:grid-cols-2">
      <SecondarySettingPanel>
        <ListeningSourceSetting />
      </SecondarySettingPanel>
      <SecondarySettingPanel>
        <HideUsernameSetting />
      </SecondarySettingPanel>
      {extraSetting ? (
        <SecondarySettingPanel className="xl:col-span-2">{extraSetting}</SecondarySettingPanel>
      ) : null}
      <SecondarySettingPanel className="xl:col-span-2">
        <BlocklistManager />
      </SecondarySettingPanel>
    </section>
  )
}

function SecondarySettingPanel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`rounded-md border bg-muted/10 p-3 ${className}`}>{children}</div>
}
