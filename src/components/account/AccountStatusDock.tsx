/**
 * AccountStatusDock - 账号状态悬浮栏组件
 * 方案三：悬浮状态栏（Dock式）设计
 *
 * 特性：
 * - 固定在页面底部，始终可见
 * - 支持紧凑模式和展开模式切换
 * - 彩色圆点表示任务状态
 * - 一键切换账号和快捷操作
 */

import { useMemoizedFn } from 'ahooks'
import { ChevronUp, Play, Square, SwitchCamera } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccountStatus, useAllAccountStatus } from '@/hooks/useAccountStatus'
import { useAccounts } from '@/hooks/useAccounts'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useOneClickStart } from '@/hooks/useOneClickStart'
import { cn } from '@/lib/utils'
import { getTaskDisplayName } from '@/tasks/taskMeta'
import type { AccountTaskState, TaskStatusInfo } from '@/types/account-status'

// 任务顺序 - 按照侧边栏从上到下排列
const TASK_ORDER = ['autoSpeak', 'autoPopup', 'autoReply', 'liveStats']
const DOCK_INTERACTIVE_SELECTOR = '[data-dock-interactive="true"]'

interface AccountStatusDockProps {
  /** 是否默认展开 */
  defaultExpanded?: boolean
  /** 紧凑模式下最多显示几个账号 */
  maxCompactAccounts?: number
}

/**
 * 获取任务状态颜色
 */
function getTaskStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-emerald-400'
    case 'error':
      return 'bg-red-400'
    case 'connecting':
      return 'bg-amber-400'
    default:
      return 'bg-muted-foreground/40'
  }
}

/**
 * 获取任务状态图标
 */
function TaskStatusDot({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  const colorClass = getTaskStatusColor(status)
  const isRunning = status === 'running'

  return (
    <span
      className={cn(
        'rounded-full inline-block',
        sizeClass,
        colorClass,
        isRunning && 'animate-pulse',
      )}
    />
  )
}

/**
 * 紧凑模式下的账号状态项
 */
function CompactAccountItem({
  accountId: _accountId,
  accountName,
  isCurrent,
  state,
  onClick,
  index,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: {
  accountId: string
  accountName: string
  isCurrent: boolean
  state?: AccountTaskState
  onClick: () => void
  index: number
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (e: React.DragEvent, index: number) => void
  isDragging: boolean
}) {
  // 获取5个任务的状态
  const taskStatuses = useMemo(() => {
    const statuses: Record<string, string> = {}
    TASK_ORDER.forEach(taskId => {
      const task = state?.tasks.find(t => t.taskId === taskId)
      statuses[taskId] = task?.status || 'idle'
    })
    return statuses
  }, [state])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          draggable
          onDragStart={() => onDragStart(index)}
          onDragOver={e => onDragOver(e, index)}
          onDrop={e => onDrop(e, index)}
          data-dock-interactive="true"
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all',
            'hover:bg-accent/30 cursor-grab active:cursor-grabbing',
            isCurrent && 'bg-primary/15 border border-primary/30',
            isDragging && 'opacity-50',
          )}
        >
          <span
            className={cn(
              'text-xs font-medium text-center truncate',
              'w-[4.5em] min-w-[4.5em] max-w-[4.5em]',
              isCurrent ? 'text-foreground' : 'text-muted-foreground',
            )}
            title={accountName}
          >
            {accountName}
          </span>
          <div className="flex items-center gap-0.5">
            {TASK_ORDER.map(taskId => (
              <TaskStatusDot key={taskId} status={taskStatuses[taskId]} size="sm" />
            ))}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-2">
        <div className="space-y-1">
          <p className={cn('font-medium text-xs', isCurrent && 'text-primary')}>{accountName}</p>
          <p className="text-xs text-muted-foreground">按住拖动可调整位置</p>
          <div className="space-y-0.5">
            {TASK_ORDER.map(taskId => (
              <div key={taskId} className="flex items-center gap-2 text-xs">
                <TaskStatusDot status={taskStatuses[taskId]} size="sm" />
                <span className="text-muted-foreground">{getTaskDisplayName(taskId)}</span>
              </div>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 展开模式下的账号状态行
 */
// 平台名称映射（与 StatusCard/PlatformSelect 保持一致，避免测试平台等显示为 raw id）
const PLATFORM_NAME_MAP: Record<string, string> = {
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

function ExpandedAccountRow({
  accountId,
  accountName,
  isCurrent,
  state,
  onSwitch,
  onQuickAction,
}: {
  accountId: string
  accountName: string
  isCurrent: boolean
  state?: AccountTaskState
  onSwitch: () => void
  onQuickAction: (action: 'start' | 'stop') => void
}) {
  // 获取5个任务的状态
  const taskStatuses = useMemo(() => {
    const statuses: Record<string, TaskStatusInfo> = {}
    TASK_ORDER.forEach(taskId => {
      const task = state?.tasks.find(t => t.taskId === taskId)
      statuses[taskId] = task || { taskId, status: 'idle' }
    })
    return statuses
  }, [state])

  // 判断是否有运行中的任务
  const hasRunningTask = useMemo(() => {
    return Object.values(taskStatuses).some(t => t.status === 'running')
  }, [taskStatuses])

  // 获取当前账号的平台信息
  const platform = useLiveControlStore(
    useMemo(() => state => state.contexts[accountId]?.connectState.platform, [accountId]),
  )
  const platformName = platform ? PLATFORM_NAME_MAP[platform] || platform : '-'

  return (
    <div
      className={cn(
        'grid grid-cols-[120px_80px_1fr_140px] items-center py-2 px-3 rounded-lg transition-colors',
        isCurrent ? 'bg-primary/10 border border-primary/20' : 'hover:bg-accent/30',
      )}
    >
      {/* 第一列：账号名称 - 固定宽度120px */}
      <div className="flex items-center gap-2 overflow-hidden">
        <span
          className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            isCurrent ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
        />
        <span
          className={cn('text-sm font-medium truncate', isCurrent && 'text-primary')}
          title={accountName}
        >
          {accountName}
        </span>
      </div>

      {/* 第二列：平台信息 - 固定宽度80px */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full border truncate max-w-full',
            isCurrent
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-muted border-muted-foreground/20 text-muted-foreground',
          )}
          title={platformName}
        >
          {platformName}
        </span>
      </div>

      {/* 第三列：5个任务状态 - 自适应宽度 */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 px-2">
        {TASK_ORDER.map(taskId => (
          <div key={taskId} className="flex items-center gap-1">
            <TaskStatusDot status={taskStatuses[taskId].status} size="md" />
            <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
              {getTaskDisplayName(taskId)}
            </span>
          </div>
        ))}
      </div>

      {/* 第四列：操作按钮 - 固定宽度140px */}
      <div className="flex items-center gap-2 justify-end">
        {!isCurrent && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSwitch}>
            <SwitchCamera className="w-3 h-3 mr-1" />
            切换
          </Button>
        )}
        {hasRunningTask ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-red-600 hover:text-red-700"
            onClick={() => onQuickAction('stop')}
          >
            <Square className="w-3 h-3 mr-1" />
            停止
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onQuickAction('start')}
          >
            <Play className="w-3 h-3 mr-1" />
            启动
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * 主组件：账号状态悬浮栏
 */
export const AccountStatusDock = React.memo(function AccountStatusDock({
  defaultExpanded = false,
  maxCompactAccounts = 4,
}: AccountStatusDockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const { accounts, currentAccountId, switchAccount, reorderAccounts } = useAccounts()
  const accountStatusMap = useAllAccountStatus()
  const { startAllTasks, stopAllTasks } = useOneClickStart()

  // 拖拽状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // 悬浮栏容器引用
  const dockRef = useRef<HTMLDivElement>(null)

  // 启动状态轮询
  useAccountStatus()

  // 点击外部收起悬浮栏
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isExpanded) return

      const target = event.target as Node
      if (dockRef.current && !dockRef.current.contains(target)) {
        setIsExpanded(false)
      }
    }

    // 使用 capture 阶段确保在事件冒泡前处理
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [isExpanded])

  // 切换展开/收起状态
  const toggleExpanded = useMemoizedFn(() => {
    setIsExpanded(prev => !prev)
  })

  const handleDockBarClick = useMemoizedFn((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest(DOCK_INTERACTIVE_SELECTOR)) {
      return
    }
    toggleExpanded()
  })

  // 切换账号
  const handleSwitchAccount = useMemoizedFn((accountId: string) => {
    if (accountId !== currentAccountId) {
      switchAccount(accountId)
    }
  })

  // 快捷操作
  const handleQuickAction = useMemoizedFn(async (accountId: string, action: 'start' | 'stop') => {
    if (action === 'start') {
      // 先切换到该账号，然后启动
      if (accountId !== currentAccountId) {
        switchAccount(accountId)
      }
      // 延迟一点确保切换完成
      setTimeout(() => {
        startAllTasks()
      }, 100)
    } else {
      // 停止操作 - 切换到该账号后停止所有任务
      if (accountId !== currentAccountId) {
        switchAccount(accountId)
      }
      // 延迟一点确保切换完成
      setTimeout(() => {
        stopAllTasks()
      }, 100)
    }
  })

  // 紧凑模式下显示的账号（保持固定顺序，不再将当前账号移到第一位）
  const compactAccounts = useMemo(() => {
    return accounts.slice(0, maxCompactAccounts)
  }, [accounts, maxCompactAccounts])

  // 是否有更多账号
  const hasMoreAccounts = accounts.length > maxCompactAccounts

  // 拖拽处理函数
  const handleDragStart = useMemoizedFn((index: number) => {
    setDraggedIndex(index)
  })

  const handleDragOver = useMemoizedFn((e: React.DragEvent, _index: number) => {
    e.preventDefault()
  })

  const handleDrop = useMemoizedFn((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      reorderAccounts(draggedIndex, dropIndex)
    }
    setDraggedIndex(null)
  })

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={dockRef}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50',
          'bg-background/95 backdrop-blur-sm border-t',
          'transition-all duration-300 ease-in-out',
          isExpanded ? 'shadow-2xl' : 'shadow-lg',
        )}
      >
        {/* 展开模式内容 - 带动画效果 */}
        <div
          id="account-status-dock-panel"
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out',
            isExpanded ? 'max-h-[60vh] opacity-100' : 'max-h-0 opacity-0',
          )}
        >
          <div className="max-h-[60vh] overflow-y-auto border-b px-4 py-3">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  多账号状态监控
                </h3>
                <span className="text-xs text-muted-foreground">共 {accounts.length} 个账号</span>
              </div>
              <div className="space-y-1">
                {accounts.map(account => (
                  <ExpandedAccountRow
                    key={account.id}
                    accountId={account.id}
                    accountName={account.name}
                    isCurrent={account.id === currentAccountId}
                    state={accountStatusMap[account.id]}
                    onSwitch={() => handleSwitchAccount(account.id)}
                    onQuickAction={action => handleQuickAction(account.id, action)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 底部栏（始终显示）- 点击可展开 */}
        <div className="cursor-pointer px-4 py-2" onClick={handleDockBarClick}>
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            {/* 左侧：标题 */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">账号状态</span>
            </div>

            {/* 中间：紧凑模式账号列表 */}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              {compactAccounts.map((account, index) => (
                <CompactAccountItem
                  key={account.id}
                  accountId={account.id}
                  accountName={account.name}
                  isCurrent={account.id === currentAccountId}
                  state={accountStatusMap[account.id]}
                  onClick={() => handleSwitchAccount(account.id)}
                  index={index}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragging={draggedIndex === index}
                />
              ))}
              {hasMoreAccounts && (
                <span className="text-xs text-muted-foreground px-2">
                  +{accounts.length - maxCompactAccounts}
                </span>
              )}
            </div>

            {/* 右侧：展开/收起按钮 */}
            <button
              type="button"
              aria-controls="account-status-dock-panel"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? '收起账号状态面板' : '展开账号状态面板'}
              data-dock-interactive="true"
              className={cn(
                'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-200',
                'hover:bg-accent/30 hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
              onClick={toggleExpanded}
            >
              <ChevronUp
                className={cn(
                  'w-4 h-4 transition-transform duration-300',
                  isExpanded && 'rotate-180',
                )}
              />
              {isExpanded ? '收起' : '展开'}
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
})

export default AccountStatusDock
