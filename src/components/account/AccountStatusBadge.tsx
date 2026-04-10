/**
 * 账号状态徽章组件
 * 在账号列表中显示任务运行状态
 */

import { AlertCircle, Circle, Loader2, Wifi } from 'lucide-react'
import { memo, useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getTaskDisplayName } from '@/tasks/taskMeta'
import type { AccountTaskState, StatusDisplayConfig } from '@/types/account-status'

interface AccountStatusBadgeProps {
  /** 账号状态 */
  state: AccountTaskState | null | undefined
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否显示文字 */
  showLabel?: boolean
  /** 自定义类名 */
  className?: string
  /** 点击回调 */
  onClick?: () => void
}

/**
 * 根据账号状态计算显示配置
 */
function getDisplayStatus(state: AccountTaskState | null | undefined): StatusDisplayConfig {
  if (!state) {
    return { type: 'idle', label: '未启动', color: 'gray' }
  }

  // 检查是否有错误状态的任务
  const hasErrorTask = state.tasks.some(task => task.status === 'error')
  if (hasErrorTask) {
    return { type: 'error', label: '运行错误', color: 'red' }
  }

  // 检查是否有运行中的任务
  const hasRunningTask = state.tasks.some(task => task.status === 'running')
  if (hasRunningTask) {
    return { type: 'running', label: '运行中', color: 'green', animate: true }
  }

  // 检查连接状态
  if (state.connectionStatus === 'connecting') {
    return { type: 'connecting', label: '连接中', color: 'yellow', animate: true }
  }

  if (state.connectionStatus === 'reconnecting') {
    return { type: 'connecting', label: '恢复中', color: 'yellow', animate: true }
  }

  if (state.connectionStatus === 'connected') {
    return { type: 'connected', label: '已连接', color: 'blue' }
  }

  if (state.connectionStatus === 'error') {
    return { type: 'error', label: '连接失败', color: 'red' }
  }

  return { type: 'idle', label: '未启动', color: 'gray' }
}

/**
 * 获取状态图标
 */
function StatusIcon({ config, size }: { config: StatusDisplayConfig; size: 'sm' | 'md' | 'lg' }) {
  const iconSize = {
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4',
  }[size]

  const iconClass = cn(iconSize, config.animate && 'animate-spin')

  switch (config.type) {
    case 'running':
      return <Loader2 className={iconClass} />
    case 'connecting':
      return <Loader2 className={iconClass} />
    case 'connected':
      return <Wifi className={iconClass} />
    case 'error':
      return <AlertCircle className={iconClass} />
    default:
      return <Circle className={iconClass} />
  }
}

/**
 * 账号状态徽章组件
 */
export const AccountStatusBadge = memo(function AccountStatusBadge({
  state,
  size = 'sm',
  showLabel = true,
  className,
  onClick,
}: AccountStatusBadgeProps) {
  const config = useMemo(() => getDisplayStatus(state), [state])

  // 颜色样式映射
  const colorStyles = {
    green: 'border-primary/25 bg-primary/10 text-primary',
    blue: 'border-primary/25 bg-primary/10 text-primary',
    yellow: 'border-primary/25 bg-primary/10 text-primary',
    red: 'border-primary/25 bg-primary/10 text-primary',
    gray: 'border-border/70 bg-muted/55 text-muted-foreground',
  }

  const sizeStyles = {
    sm: 'px-1.5 py-0.5 text-xs gap-1',
    md: 'px-2 py-1 text-sm gap-1.5',
    lg: 'px-2.5 py-1 text-sm gap-1.5',
  }

  const badgeContent = (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium transition-colors',
        colorStyles[config.color],
        sizeStyles[size],
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
      onClick={onClick}
    >
      <StatusIcon config={config} size={size} />
      {showLabel && <span>{config.label}</span>}
    </span>
  )

  // 生成悬停提示内容
  const tooltipContent = useMemo(() => {
    if (!state) return '暂无状态信息'

    const lines: string[] = []

    // 连接状态
    const connectionLabels: Record<string, string> = {
      disconnected: '未连接中控台',
      connecting: '正在连接中控台...',
      reconnecting: '正在恢复中控台连接...',
      connected: '中控台已连接',
      error: '中控台连接失败',
    }
    lines.push(`连接: ${connectionLabels[state.connectionStatus] || '未知'}`)

    // 任务状态
    if (state.tasks.length > 0) {
      lines.push('')
      lines.push('任务状态:')
      state.tasks.forEach(task => {
        const statusLabels: Record<string, string> = {
          idle: '待执行',
          running: '运行中',
          stopped: '已停止',
          error: '出错',
        }
        const taskName = getTaskDisplayName(task.taskId)
        lines.push(`  • ${taskName}: ${statusLabels[task.status] || task.status}`)
        if (task.count !== undefined) {
          lines.push(`    已执行: ${task.count} 次`)
        }
        if (task.duration !== undefined) {
          const mins = Math.floor(task.duration / 60)
          const secs = task.duration % 60
          lines.push(`    运行时长: ${mins}分${secs}秒`)
        }
        if (task.errorMessage) {
          lines.push(`    错误: ${task.errorMessage}`)
        }
      })
    }

    return lines.join('\n')
  }, [state])

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
        <TooltipContent side="right" align="center" className="max-w-xs whitespace-pre-line">
          <p className="text-xs">{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})

export default AccountStatusBadge
