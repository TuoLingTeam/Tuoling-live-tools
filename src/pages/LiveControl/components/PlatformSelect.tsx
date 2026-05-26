import { useMemoizedFn } from 'ahooks'
import { LockKeyhole } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentLiveControl, useCurrentLiveControlActions } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { usePlatformPreferenceStore } from '@/stores/platformPreferenceStore'

const basePlatforms: Record<string, string> = {
  douyin: '抖音小店',
  buyin: '巨量百应',
  eos: '抖音团购',
  xiaohongshu: '小红书千帆',
  pgy: '小红书蒲公英',
  wxchannel: '视频号',
  kuaishou: '快手小店',
  taobao: '淘宝',
  dev: '测试平台',
}

const platforms = basePlatforms

const PlatformSelect = React.memo((props: { fullWidth?: boolean } = {}) => {
  const { fullWidth } = props
  const connectState = useCurrentLiveControl(context => context.connectState)
  const { setPlatform } = useCurrentLiveControlActions()
  const { toast } = useToast()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const boundPlatform = useAccounts(state => {
    const currentAccount = state.accounts.find(account => account.id === state.currentAccountId)
    return currentAccount?.platform && platforms[currentAccount.platform]
      ? currentAccount.platform
      : null
  })
  const [defaultPlatform, setDefaultPlatform] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  // 使用新的平台偏好设置 store
  const getDefaultPlatform = usePlatformPreferenceStore(state => state.getDefaultPlatform)
  const saveDefaultPlatform = usePlatformPreferenceStore(state => state.setDefaultPlatform)
  const systemDefaultPlatform = usePlatformPreferenceStore(state => state.systemDefaultPlatform)

  // 账号切换时重置初始化状态
  useEffect(() => {
    if (!currentAccountId) {
      setHasInitialized(false)
      setDefaultPlatform(null)
      return
    }

    setHasInitialized(false)
    setDefaultPlatform(null)
  }, [currentAccountId])

  useEffect(() => {
    if (!boundPlatform) {
      return
    }

    setDefaultPlatform(null)
    setOpen(false)
    setHasInitialized(true)

    if (connectState.platform !== boundPlatform) {
      console.log('[PlatformSelect] 当前账号已绑定平台，锁定选择:', boundPlatform)
      setPlatform(boundPlatform)
    }
  }, [boundPlatform, connectState.platform, setPlatform])

  // 初始化：加载默认平台
  useEffect(() => {
    if (hasInitialized || !currentAccountId || boundPlatform) return

    console.log(
      '[PlatformSelect] 初始化：当前账号:',
      currentAccountId,
      '当前平台:',
      connectState.platform,
    )

    try {
      // 使用 store 获取默认平台
      const savedDefaultPlatform = getDefaultPlatform(currentAccountId)

      if (savedDefaultPlatform && platforms[savedDefaultPlatform]) {
        setDefaultPlatform(savedDefaultPlatform)
        // 【修复】只在当前没有平台选择时，才设置默认平台
        // 这样可以保留用户手动选择的平台，不会被默认平台覆盖
        if (!connectState.platform) {
          console.log(
            '[PlatformSelect] 初始化：当前无平台选择，自动选中默认平台:',
            savedDefaultPlatform,
          )
          setPlatform(savedDefaultPlatform)
        } else {
          console.log(
            '[PlatformSelect] 初始化：已存在平台选择:',
            connectState.platform,
            '保留当前选择',
          )
        }
      } else {
        setDefaultPlatform(null)
        // 如果没有默认平台，且当前也没有平台选择，使用系统默认平台作为兜底
        if (!connectState.platform) {
          console.log(
            '[PlatformSelect] 初始化：无默认平台且当前无选择，使用系统默认:',
            systemDefaultPlatform,
          )
          setPlatform(systemDefaultPlatform)
        }
      }
    } catch (error) {
      console.error('[PlatformSelect] 加载默认平台失败:', error)
      // 出错时，如果当前没有平台选择，使用系统默认平台兜底
      setDefaultPlatform(null)
      if (!connectState.platform) {
        setPlatform(systemDefaultPlatform)
      }
    }

    setHasInitialized(true)
  }, [
    currentAccountId,
    boundPlatform,
    hasInitialized,
    setPlatform,
    getDefaultPlatform,
    systemDefaultPlatform,
    connectState.platform,
  ])

  const handlePlatformChange = useMemoizedFn((newPlatform: string) => {
    console.log('[Platform Select] Platform changed:', connectState.platform, '→', newPlatform)
    setPlatform(newPlatform)
  })

  const handleSetDefault = useCallback(
    (platformKey: string, platformName: string) => {
      console.log('[PlatformSelect] 设置默认平台:', platformKey, '账号:', currentAccountId)

      if (!currentAccountId) {
        console.warn('[PlatformSelect] 无当前账号，无法设置默认平台')
        toast.error('设置失败：未找到当前账号')
        return
      }

      try {
        // 使用 store 保存默认平台
        saveDefaultPlatform(currentAccountId, platformKey)

        // 更新状态
        setDefaultPlatform(platformKey)

        // 自动选中默认平台
        setPlatform(platformKey)

        // 显示成功提示
        toast.success(`已将默认平台设置为：${platformName}`)

        console.log('[PlatformSelect] 默认平台设置完成:', platformKey)
      } catch (error) {
        console.error('[PlatformSelect] 保存默认平台失败:', error)
        toast.error('设置默认平台失败，请重试')
      }
    },
    [setPlatform, toast, currentAccountId, saveDefaultPlatform],
  )

  // 确保选择框始终有值
  const selectedPlatform =
    boundPlatform || connectState.platform || defaultPlatform || systemDefaultPlatform
  const displayValue = platforms[selectedPlatform] || selectedPlatform
  const triggerClassName = cn(
    fullWidth ? 'h-10 w-full min-w-0 sm:w-[13.5rem]' : 'h-10 w-[13.5rem]',
    'border-border/40 bg-muted/20 text-foreground text-sm',
  )

  if (boundPlatform) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            aria-disabled="true"
            className={cn(
              triggerClassName,
              'flex cursor-not-allowed select-none items-center justify-between gap-2 rounded-lg border px-3 py-2 opacity-85',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span className="truncate">{displayValue}</span>
            </span>
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] leading-4 text-primary">
              已绑定
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>该账号已绑定{displayValue}，平台不可切换</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Select
      value={selectedPlatform}
      onValueChange={handlePlatformChange}
      disabled={connectState.status !== 'disconnected'}
      open={open}
      onOpenChange={setOpen}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[12rem]">
        {Object.entries(platforms).map(([key, name]) => {
          const isDefault = defaultPlatform === key

          return (
            <div
              key={key}
              className="flex items-center justify-between px-2 py-1.5 hover:bg-accent cursor-pointer group"
              onClick={() => {
                handlePlatformChange(key)
                setOpen(false)
              }}
            >
              <span className="flex items-center gap-2 text-sm">
                <span>{name}</span>
              </span>
              <button
                type="button"
                onPointerDown={e => {
                  e.stopPropagation()
                }}
                onClick={e => {
                  e.stopPropagation()
                  e.preventDefault()
                  console.log('[PlatformSelect] 点击设为默认:', key)
                  handleSetDefault(key, name)
                }}
                className={`ml-2 px-2 py-0.5 text-[11px] rounded transition-all duration-200 ${
                  isDefault
                    ? 'bg-orange-500/20 text-orange-500 font-medium'
                    : 'bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20'
                }`}
              >
                {isDefault ? '默认' : '设为默认'}
              </button>
            </div>
          )
        })}
      </SelectContent>
    </Select>
  )
})

export default PlatformSelect
