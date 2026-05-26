import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  DatabaseZap,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { buildMentionedReplyContent, stripMentionedReplyContent } from '@/hooks/autoReplyRuntime'
import type { Message, ReplyPreview } from '@/hooks/autoReplyTypes'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import {
  type AutoReplyConfig,
  resolveAutoReplyConfigForAccount,
  useAutoReplyConfigStore,
} from '@/hooks/useAutoReplyConfig'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import AutoReplyHistorySheet, {
  type AutoReplyHistoryKeywordRuleDraft,
} from './AutoReplyHistorySheet'
import AutoReplyInsightsSheet from './AutoReplyInsightsSheet'
import {
  type AutoReplyWorkbenchTaskStatus,
  buildAutoReplyKnowledgeBasis,
  buildAutoReplyWorkbenchConversation,
  buildScopedAutoReplyWorkbenchTasks,
  formatAutoReplyConversationTime,
  getAutoReplyKeywordReplyMatchForMessage,
  getAutoReplyMessageDetail,
  getAutoReplyMessageDisplayName,
  getAutoReplyWorkbenchTaskKey,
  getAutoReplyWorkbenchTaskState,
  mergeAutoReplyKnowledgeRules,
  type ScopedWorkbenchSource,
  type WorkbenchConversationMessage,
} from './autoReplyWorkbenchModel'

type Reply = ReplyPreview
type Comment = Message
type TaskTone = 'precise' | 'warm'
type AccountQueueFilterOption = {
  accountId: string
  accountName: string
  platformLabel: string
  isListening: boolean
}

const ALL_ACCOUNT_FILTER = 'all'
const WORKBENCH_STATUS_ORDER: AutoReplyWorkbenchTaskStatus[] = [
  'sent',
  'ignored',
  'configured',
  'unconfigured',
]
const PENDING_WORKBENCH_STATUSES = new Set<AutoReplyWorkbenchTaskStatus>(['unconfigured'])
const WORKBENCH_STATUS_META: Record<
  AutoReplyWorkbenchTaskStatus,
  { label: string; variant: BadgeProps['variant'] }
> = {
  sent: { label: '已发送', variant: 'success' },
  ignored: { label: '已忽略', variant: 'neutral' },
  configured: { label: '已配置', variant: 'info' },
  unconfigured: { label: '未配置', variant: 'warning' },
}

const PLATFORM_LABELS: Partial<Record<LiveControlPlatform, string>> = {
  douyin: '抖音',
  buyin: '巨量百应',
  wxchannel: '视频号',
  xiaohongshu: '小红书',
  pgy: '蒲公英',
  taobao: '淘宝',
  dev: '测试平台',
}

function getAgeLabel(time?: string) {
  if (!time) return ''

  const clockMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i)
  if (clockMatch) {
    const meridiem = clockMatch[4]?.toUpperCase()
    let hours = Number(clockMatch[1])
    if (meridiem === 'PM' && hours < 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0

    const now = new Date()
    const then = new Date(now)
    then.setHours(hours, Number(clockMatch[2]), Number(clockMatch[3] ?? 0), 0)
    const diffMinutes = Math.floor((now.getTime() - then.getTime()) / 60000)
    if (diffMinutes >= 0 && diffMinutes < 24 * 60) {
      return `${Math.max(diffMinutes, 1)}m`
    }
    return ''
  }

  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return ''
  const diffMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000)
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes}m`
  return `${Math.floor(diffMinutes / 60)}h`
}

function ReplyTaskCard({
  comment,
  accountName,
  platformLabel,
  status,
  selected,
  onSelect,
  nodeRef,
}: {
  comment: Comment
  accountName: string
  platformLabel: string
  status: AutoReplyWorkbenchTaskStatus
  selected: boolean
  onSelect: () => void
  nodeRef: (node: HTMLButtonElement | null) => void
}) {
  const statusMeta = WORKBENCH_STATUS_META[status]
  const detail = getAutoReplyMessageDetail(comment)
  const age = getAgeLabel(comment.time)
  const displayName = getAutoReplyMessageDisplayName(comment)
  const displayTime = formatAutoReplyConversationTime(comment.time)

  return (
    <button
      ref={nodeRef}
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative w-full rounded-md border px-3 py-2 text-left transition-colors',
        'hover:border-primary/30 hover:bg-primary/8',
        selected
          ? 'border-primary/45 bg-primary/12 shadow-[inset_3px_0_0_hsl(var(--primary))]'
          : 'border-border/70 bg-[var(--surface-muted)]/75',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div
          className={cn(
            'mt-1 h-9 w-1 rounded-full',
            selected ? 'bg-primary' : 'bg-border group-hover:bg-primary/45',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {displayName}
            </span>
            <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              {accountName}
            </span>
            <span className="shrink-0 rounded border border-info/20 bg-info/10 px-1.5 py-0.5 text-[11px] text-info">
              {platformLabel}
            </span>
            {displayTime ? (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {displayTime}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-foreground/90">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={statusMeta.variant} className="h-5 rounded px-1.5 text-[11px]">
            {statusMeta.label}
          </Badge>
          {age ? <span className="text-[11px] text-muted-foreground">{age}</span> : null}
        </div>
      </div>
    </button>
  )
}

function WorkbenchStatusFilters({
  value,
  counts,
  pendingCount,
  onValueChange,
}: {
  value: AutoReplyWorkbenchTaskStatus | null
  counts: Record<AutoReplyWorkbenchTaskStatus, number>
  pendingCount: number
  onValueChange: (value: AutoReplyWorkbenchTaskStatus | null) => void
}) {
  const pendingSelected = value === null
  const filterButtonClassName =
    'inline-flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60'
  const inactiveFilterButtonClassName =
    'border-border/70 bg-background/35 text-muted-foreground hover:border-primary/30 hover:bg-primary/8 hover:text-foreground'
  const activeFilterButtonClassName = 'border-primary/45 bg-primary/12 text-primary'

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        aria-pressed={pendingSelected}
        className={cn(
          filterButtonClassName,
          'shrink-0',
          pendingSelected ? activeFilterButtonClassName : inactiveFilterButtonClassName,
        )}
        onClick={() => onValueChange(null)}
      >
        <span>待回复</span>
        <span className="tabular-nums text-current/75">{pendingCount}</span>
      </button>

      {WORKBENCH_STATUS_ORDER.map(status => {
        const meta = WORKBENCH_STATUS_META[status]
        const selected = value === status

        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            className={cn(
              filterButtonClassName,
              'shrink-0',
              selected ? activeFilterButtonClassName : inactiveFilterButtonClassName,
            )}
            onClick={() => onValueChange(selected ? null : status)}
          >
            <span>{meta.label}</span>
            <span className="tabular-nums text-current/75">{counts[status]}</span>
          </button>
        )
      })}
    </div>
  )
}

function matchesWorkbenchStatusFilter(
  row: {
    isSent: boolean
    isIgnored: boolean
    isConfigured: boolean
    isUnconfigured: boolean
  },
  filter: AutoReplyWorkbenchTaskStatus,
) {
  switch (filter) {
    case 'sent':
      return row.isSent
    case 'ignored':
      return row.isIgnored
    case 'configured':
      return row.isConfigured
    case 'unconfigured':
      return row.isUnconfigured
  }
}

function AccountQueueFilter({
  value,
  options,
  onValueChange,
}: {
  value: string
  options: AccountQueueFilterOption[]
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.accountId === value)
  const selectedLabel =
    value === ALL_ACCOUNT_FILTER ? '全部账号' : selectedOption?.accountName || '选择账号'

  const selectValue = useCallback(
    (nextValue: string) => {
      onValueChange(nextValue)
      setOpen(false)
    },
    [onValueChange],
  )

  const renderCheck = (selected: boolean) => (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded text-primary',
        selected ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    >
      <Check className="h-3.5 w-3.5" />
    </span>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="选择评论队列账号范围"
          className="h-8 w-[13.5rem] justify-between gap-2 rounded-md border-border/70 bg-[var(--surface-elevated)]/85 px-2 text-xs hover:border-primary/35 hover:bg-primary/10"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">{selectedLabel}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[18rem] p-1">
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            aria-pressed={value === ALL_ACCOUNT_FILTER}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
              'hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60',
              value === ALL_ACCOUNT_FILTER ? 'bg-primary/10 text-primary' : 'text-foreground',
            )}
            onClick={() => selectValue(ALL_ACCOUNT_FILTER)}
          >
            {renderCheck(value === ALL_ACCOUNT_FILTER)}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">全部账号</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">全部直播账号</span>
            </span>
          </button>

          <div className="my-1 h-px bg-border/70" />

          {options.map(option => {
            const selected = value === option.accountId
            return (
              <button
                key={option.accountId}
                type="button"
                title={option.accountName}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                  'hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60',
                  selected ? 'bg-primary/10 text-primary' : 'text-foreground',
                )}
                onClick={() => selectValue(option.accountId)}
              >
                {renderCheck(selected)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {option.accountName}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{option.platformLabel}</span>
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        option.isListening ? 'bg-success' : 'bg-muted-foreground/45',
                      )}
                      aria-hidden="true"
                    />
                    <span>{option.isListening ? '监听中' : '未监听'}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ConversationMessageBubble({
  message,
  showMeta,
}: {
  message: WorkbenchConversationMessage
  showMeta: boolean
}) {
  const isOperator = message.role === 'operator'

  return (
    <div className={cn('flex items-end gap-2', isOperator ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[min(40rem,86%)] flex-col', isOperator && 'items-end')}>
        <div className="min-h-5">
          {showMeta ? (
            <div
              className={cn(
                'mb-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground',
                isOperator && 'justify-end',
              )}
            >
              {isOperator ? <Bot className="h-3.5 w-3.5 text-primary" /> : null}
              <span className="truncate">{message.author}</span>
              {message.sourceLabel ? (
                <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-primary">
                  {message.sourceLabel}
                </span>
              ) : null}
              {message.isCurrentComment ? (
                <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-warning">
                  当前
                </span>
              ) : null}
              {message.timeLabel ? (
                <span className="tabular-nums">· {message.timeLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            'rounded-2xl border px-3.5 py-2.5 text-sm leading-6 text-foreground/92 shadow-sm',
            isOperator
              ? 'rounded-br-sm border-primary/30 bg-primary/15'
              : message.isCurrentComment
                ? 'rounded-bl-sm border-warning/45 bg-warning/12 shadow-[inset_3px_0_0_hsl(var(--warning))]'
                : 'rounded-bl-sm border-border/70 bg-[var(--surface-elevated)]/90',
          )}
        >
          {message.content}
        </div>
      </div>
      {isOperator ? (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
          <Bot className="h-3.5 w-3.5" />
        </div>
      ) : null}
    </div>
  )
}

function KnowledgePill({
  children,
  onEdit,
  onRemove,
  tone = 'neutral',
}: {
  children: string
  onEdit?: (value: string) => void
  onRemove?: () => void
  tone?: 'neutral' | 'primary'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(children)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isEditing) {
      setDraft(children)
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [children, isEditing])

  const commitEdit = useCallback(() => {
    const nextValue = draft.trim()
    setIsEditing(false)
    if (!nextValue || nextValue === children) {
      setDraft(children)
      return
    }
    onEdit?.(nextValue)
  }, [children, draft, onEdit])

  const cancelEdit = useCallback(() => {
    setDraft(children)
    setIsEditing(false)
  }, [children])

  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center rounded-md border px-2 py-1 text-[12px] font-medium',
        tone === 'primary'
          ? 'border-primary/25 bg-primary/10 text-primary'
          : 'border-border/70 bg-background/40 text-foreground/85',
      )}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label={`编辑关键词 ${children}`}
          className="h-5 w-[7.5rem] min-w-0 bg-transparent p-0 text-[12px] font-medium text-current outline-none"
          onChange={event => setDraft(event.target.value.slice(0, 20))}
          onBlur={commitEdit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitEdit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEdit()
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={`编辑关键词 ${children}`}
          className={cn(
            'min-w-0 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-current/60',
            onEdit ? 'cursor-text' : 'cursor-default',
          )}
          onClick={() => {
            if (onEdit) setIsEditing(true)
          }}
        >
          {children}
        </button>
      )}
      {onRemove && !isEditing ? (
        <button
          type="button"
          aria-label={`删除关键词 ${children}`}
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-current/70 transition-colors hover:bg-current/10 hover:text-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/60"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  )
}

function KnowledgeBasisBlock({
  icon,
  label,
  values,
  onEditValue,
  onRemoveValue,
  tone,
}: {
  icon: ReactNode
  label: string
  values: string[]
  onEditValue?: (index: number, value: string) => void
  onRemoveValue?: (value: string) => void
  tone?: 'neutral' | 'primary'
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value, index) => (
            <KnowledgePill
              key={`${value}:${index}`}
              tone={tone}
              onEdit={onEditValue ? nextValue => onEditValue(index, nextValue) : undefined}
              onRemove={onRemoveValue ? () => onRemoveValue(value) : undefined}
            >
              {value}
            </KnowledgePill>
          ))
        ) : (
          <span className="text-[12px] text-muted-foreground">从观众评论生成</span>
        )}
      </div>
    </div>
  )
}

function StatusHint({
  selectedReply,
  configuredReplyContent,
  pendingCount,
}: {
  selectedReply?: Reply
  configuredReplyContent?: string
  pendingCount: number
}) {
  if (selectedReply?.autoSendBlockedReason) {
    return (
      <>
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        <span>该回复已被自动发送保护拦截，请人工确认。</span>
      </>
    )
  }

  if (selectedReply?.isSent && selectedReply.source === 'manual') {
    return (
      <>
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        <span>人工回复已生成知识候选，确认后保存，不会自动入库。</span>
      </>
    )
  }

  if (selectedReply?.isSent) {
    return (
      <>
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        <span>该回复已发送，可继续沉淀为知识。</span>
      </>
    )
  }

  if (configuredReplyContent) {
    return (
      <>
        <CheckCircle2 className="h-3.5 w-3.5 text-info" />
        <span>已命中关键词回复，可直接查看或继续完善。</span>
      </>
    )
  }

  return (
    <>
      <Clock3 className="h-3.5 w-3.5" />
      <span>当前还有 {pendingCount} 条可处理评论。</span>
    </>
  )
}

export default function AutoReplyWorkbench() {
  const accounts = useAccounts(state => state.accounts)
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const autoReplyContexts = useAutoReplyStore(state => state.contexts)
  const addReply = useAutoReplyStore(state => state.addReply)
  const clearHistoryForAccount = useAutoReplyStore(state => state.clearHistory)
  const configContexts = useAutoReplyConfigStore(state => state.contexts)
  const updateAutoReplyConfig = useAutoReplyConfigStore(state => state.updateConfig)
  const liveControlContexts = useLiveControlStore(state => state.contexts)
  const { toast } = useToast()
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const conversationScrollRef = useRef<HTMLDivElement | null>(null)
  const [accountFilter, setAccountFilter] = useState<string>(ALL_ACCOUNT_FILTER)
  const [statusFilter, setStatusFilter] = useState<AutoReplyWorkbenchTaskStatus | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [tone, setTone] = useState<TaskTone>('precise')
  const [draft, setDraft] = useState('')
  const [knowledgeDraft, setKnowledgeDraft] = useState('')
  const [knowledgeKeywords, setKnowledgeKeywords] = useState<string[]>([])
  const [isSendingDraft, setIsSendingDraft] = useState(false)
  const sentDraftCommentIdRef = useRef<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const accountSources = useMemo<ScopedWorkbenchSource[]>(() => {
    return accounts.map(account => {
      const autoReplyContext = autoReplyContexts[account.id]
      const liveControlContext = liveControlContexts[account.id]
      const isListening = autoReplyContext?.isListening === 'listening'
      const platform = liveControlContext?.connectState.platform || account.platform
      const liveAccountName = liveControlContext?.accountName?.trim()
      const operatorNames = [liveAccountName, account.name].filter((name): name is string =>
        Boolean(name?.trim()),
      )

      return {
        accountId: account.id,
        accountName: liveAccountName || account.name,
        platformLabel: PLATFORM_LABELS[platform as LiveControlPlatform] || '直播间',
        operatorName: operatorNames,
        comments: isListening ? (autoReplyContext?.comments ?? []) : [],
        replies: isListening ? (autoReplyContext?.replies ?? []) : [],
      }
    })
  }, [accounts, autoReplyContexts, liveControlContexts])

  const historyAccounts = useMemo(
    () =>
      accountSources.map(source => {
        const autoReplyContext = autoReplyContexts[source.accountId]

        return {
          accountId: source.accountId,
          accountName: source.accountName,
          platformLabel: source.platformLabel,
          comments: autoReplyContext?.comments ?? [],
          replies: autoReplyContext?.replies ?? [],
          historySessions: autoReplyContext?.historySessions ?? [],
          currentSessionStartedAt: autoReplyContext?.currentSessionStartedAt ?? null,
          currentSessionEndedAt: autoReplyContext?.currentSessionEndedAt ?? null,
        }
      }),
    [accountSources, autoReplyContexts],
  )

  const accountConfigById = useMemo(() => {
    const configs = new Map<string, AutoReplyConfig>()
    for (const account of accounts) {
      configs.set(
        account.id,
        resolveAutoReplyConfigForAccount(account.id, configContexts[account.id]?.config),
      )
    }
    return configs
  }, [accounts, configContexts])
  const accountConfigsForHistory = useMemo(() => {
    const configs: Record<string, AutoReplyConfig> = {}
    for (const [accountId, config] of accountConfigById) {
      configs[accountId] = config
    }
    return configs
  }, [accountConfigById])

  const allTasks = useMemo(
    () => buildScopedAutoReplyWorkbenchTasks({ sources: accountSources }),
    [accountSources],
  )

  const filterAccountOptions = accountSources

  useEffect(() => {
    if (
      accountFilter !== ALL_ACCOUNT_FILTER &&
      !accounts.some(account => account.id === accountFilter)
    ) {
      setAccountFilter(ALL_ACCOUNT_FILTER)
    }
  }, [accountFilter, accounts])

  const visibleSources = useMemo(() => {
    if (accountFilter === ALL_ACCOUNT_FILTER) return accountSources
    return accountSources.filter(source => source.accountId === accountFilter)
  }, [accountFilter, accountSources])

  const tasks = useMemo(() => {
    if (accountFilter === ALL_ACCOUNT_FILTER) return allTasks
    return allTasks.filter(task => task.accountId === accountFilter)
  }, [accountFilter, allTasks])

  const taskRows = useMemo(
    () =>
      tasks.map(task => {
        const state = getAutoReplyWorkbenchTaskState({
          task,
          config: accountConfigById.get(task.accountId),
          nowMs,
        })

        return {
          task,
          ...state,
        }
      }),
    [accountConfigById, nowMs, tasks],
  )

  const pendingCount = useMemo(
    () => taskRows.filter(row => PENDING_WORKBENCH_STATUSES.has(row.status)).length,
    [taskRows],
  )

  const statusCounts = useMemo(() => {
    const counts: Record<AutoReplyWorkbenchTaskStatus, number> = {
      sent: 0,
      ignored: 0,
      configured: 0,
      unconfigured: 0,
    }
    for (const row of taskRows) {
      if (row.isSent) counts.sent += 1
      if (row.isIgnored) counts.ignored += 1
      if (row.isConfigured) counts.configured += 1
      if (row.isUnconfigured) counts.unconfigured += 1
    }
    return counts
  }, [taskRows])

  const visibleTaskRows = useMemo(() => {
    if (statusFilter) return taskRows.filter(row => matchesWorkbenchStatusFilter(row, statusFilter))
    return taskRows.filter(row => PENDING_WORKBENCH_STATUSES.has(row.status))
  }, [statusFilter, taskRows])

  const isAnyVisibleAccountListening = visibleSources.some(
    source => autoReplyContexts[source.accountId]?.isListening === 'listening',
  )

  useEffect(() => {
    if (visibleTaskRows.length === 0) {
      setSelectedTaskKey(null)
      return
    }
    if (!selectedTaskKey || !visibleTaskRows.some(row => row.task.taskKey === selectedTaskKey)) {
      setSelectedTaskKey(visibleTaskRows[0].task.taskKey)
    }
  }, [selectedTaskKey, visibleTaskRows])

  const selectedTaskRow = useMemo(() => {
    return visibleTaskRows.find(row => row.task.taskKey === selectedTaskKey) ?? visibleTaskRows[0]
  }, [selectedTaskKey, visibleTaskRows])
  const selectedTask = selectedTaskRow?.task
  const selectedTaskStatus = selectedTaskRow?.status
  const selectedTaskId = selectedTask?.taskKey ?? null
  const selectedAccountId =
    selectedTask?.accountId ??
    (accountFilter !== ALL_ACCOUNT_FILTER ? accountFilter : currentAccountId)
  const selectedAccount = accounts.find(account => account.id === selectedAccountId)
  const selectedAutoReplyContext = selectedAccountId
    ? autoReplyContexts[selectedAccountId]
    : undefined
  const selectedLiveControlContext = selectedAccountId
    ? liveControlContexts[selectedAccountId]
    : undefined
  const selectedAccountName = selectedTask?.accountName ?? selectedAccount?.name ?? '当前账号'
  const selectedPlatformLabel =
    selectedTask?.platformLabel ??
    PLATFORM_LABELS[
      (selectedLiveControlContext?.connectState.platform ||
        selectedAccount?.platform) as LiveControlPlatform
    ] ??
    '直播间'
  const selectedOperatorNames = useMemo(() => {
    if (Array.isArray(selectedTask?.operatorName)) return selectedTask.operatorName
    if (selectedTask?.operatorName) return [selectedTask.operatorName]
    return [selectedLiveControlContext?.accountName, selectedAccountName].filter(
      (name): name is string => Boolean(name?.trim()),
    )
  }, [selectedAccountName, selectedLiveControlContext?.accountName, selectedTask?.operatorName])
  const operatorDisplayName = selectedOperatorNames[0] ?? null
  const selectedConfig = useMemo(
    () =>
      resolveAutoReplyConfigForAccount(
        selectedAccountId,
        selectedAccountId ? configContexts[selectedAccountId]?.config : undefined,
      ),
    [configContexts, selectedAccountId],
  )
  const selectedComments = selectedAutoReplyContext?.comments ?? []
  const selectedReplies = selectedAutoReplyContext?.replies ?? []
  const selectedHistorySessions = selectedAutoReplyContext?.historySessions ?? []
  const selectedCurrentSessionId = selectedAutoReplyContext?.currentSessionId ?? null
  const selectedCurrentSessionStartedAt = selectedAutoReplyContext?.currentSessionStartedAt ?? null
  const selectedCurrentSessionEndedAt = selectedAutoReplyContext?.currentSessionEndedAt ?? null
  const clearSelectedHistory = useCallback(() => {
    if (selectedAccountId) {
      clearHistoryForAccount(selectedAccountId)
    }
  }, [clearHistoryForAccount, selectedAccountId])
  const selectedComment = selectedTask?.comment
  const selectedQuestion = selectedComment ? getAutoReplyMessageDetail(selectedComment).trim() : ''
  const knowledgeBasis = useMemo(
    () => buildAutoReplyKnowledgeBasis(selectedQuestion),
    [selectedQuestion],
  )
  const defaultKnowledgeKeywords = useMemo(
    () =>
      knowledgeBasis.keywords.length ? knowledgeBasis.keywords : knowledgeBasis.questionSegments,
    [knowledgeBasis],
  )
  const selectedKeywordReplyMatch = useMemo(
    () =>
      selectedComment
        ? getAutoReplyKeywordReplyMatchForMessage(selectedComment, selectedConfig)
        : null,
    [selectedComment, selectedConfig],
  )
  const selectedConfiguredReplyContent = selectedKeywordReplyMatch?.content ?? ''
  const selectedReplyContent = selectedTask?.reply?.replyContent ?? selectedConfiguredReplyContent
  const selectedDraftContent = selectedComment
    ? buildMentionedReplyContent(
        selectedReplyContent,
        selectedComment.nick_name,
        selectedConfig.hideUsername,
      )
    : selectedReplyContent
  const selectedKnowledgeDraftContent = selectedComment
    ? stripMentionedReplyContent(
        selectedReplyContent,
        selectedComment.nick_name,
        selectedConfig.hideUsername,
      )
    : selectedReplyContent
  const conversationMessages = useMemo(
    () =>
      buildAutoReplyWorkbenchConversation({
        selectedComment: selectedTask?.comment,
        comments: selectedComments,
        replies: selectedReplies,
        operatorName: operatorDisplayName,
      }),
    [operatorDisplayName, selectedComments, selectedReplies, selectedTask?.comment],
  )
  const conversationScrollKey = `${selectedTaskId ?? ''}:${conversationMessages.at(-1)?.id ?? ''}:${conversationMessages.length}`

  useEffect(() => {
    if (!selectedTaskId) {
      setDraft('')
      setKnowledgeDraft('')
      return
    }
    if (sentDraftCommentIdRef.current === selectedTaskId && selectedTask?.reply?.isSent) {
      setDraft('')
      setKnowledgeDraft(selectedKnowledgeDraftContent)
      return
    }
    setDraft(selectedDraftContent)
    setKnowledgeDraft(selectedKnowledgeDraftContent)
  }, [
    selectedDraftContent,
    selectedKnowledgeDraftContent,
    selectedTask?.reply?.isSent,
    selectedTaskId,
  ])

  useEffect(() => {
    setKnowledgeKeywords(selectedTaskId ? [...defaultKnowledgeKeywords] : [])
  }, [defaultKnowledgeKeywords, selectedTaskId])

  useEffect(() => {
    if (!conversationScrollKey) return
    const node = conversationScrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [conversationScrollKey])

  const handleLocateComment = useCallback(
    (commentId: string) => {
      if (!selectedAccountId) return
      const nextTaskKey = getAutoReplyWorkbenchTaskKey(selectedAccountId, commentId)
      const locatedRow = taskRows.find(row => row.task.taskKey === nextTaskKey)
      if (locatedRow) {
        setStatusFilter(
          PENDING_WORKBENCH_STATUSES.has(locatedRow.status) ? null : locatedRow.status,
        )
      }
      setSelectedTaskKey(nextTaskKey)
      requestAnimationFrame(() => {
        itemRefs.current[nextTaskKey]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    },
    [selectedAccountId, taskRows],
  )

  const handleSendDraft = useCallback(async () => {
    if (isSendingDraft) {
      return
    }
    const content = draft.trim()
    if (!selectedTask) {
      toast.warning('请先选择一条评论')
      return
    }
    if (!content) {
      toast.warning('回复内容不能为空')
      return
    }

    try {
      setIsSendingDraft(true)
      const sendContent = buildMentionedReplyContent(
        content,
        selectedTask.comment.nick_name,
        selectedConfig.hideUsername,
      )
      const sent = await window.autoReplyAPI.sendReply(selectedTask.accountId, sendContent)
      if (!sent) {
        toast.error('发送回复失败')
        return
      }

      addReply(
        selectedTask.accountId,
        selectedTask.comment.msg_id,
        getAutoReplyMessageDisplayName(selectedTask.comment),
        sendContent,
        {
          source: 'manual',
          replyIntent: 'chat',
          factStatus: 'not-applicable',
          guardrailAction: 'pass',
        },
        true,
      )
      sentDraftCommentIdRef.current = selectedTask.taskKey
      setDraft('')
      setKnowledgeDraft(content)
      setKnowledgeKeywords([...defaultKnowledgeKeywords])
      toast.success({
        title: '回复已发送',
        description: '已生成知识候选，确认后可保存。',
        dedupeKey: `auto-reply-manual-candidate:${selectedTask.accountId}:${selectedTask.comment.msg_id}`,
      })
    } catch (error) {
      console.error('发送回复失败:', error)
      toast.error('发送回复失败')
    } finally {
      setIsSendingDraft(false)
    }
  }, [
    addReply,
    defaultKnowledgeKeywords,
    draft,
    isSendingDraft,
    selectedConfig.hideUsername,
    selectedTask,
    toast,
  ])

  const handleResetKnowledgeDraft = useCallback(() => {
    setKnowledgeDraft(selectedKnowledgeDraftContent)
    setKnowledgeKeywords([...defaultKnowledgeKeywords])
  }, [defaultKnowledgeKeywords, selectedKnowledgeDraftContent])

  const handleRemoveKnowledgeKeyword = useCallback((keyword: string) => {
    setKnowledgeKeywords(current => current.filter(value => value !== keyword))
  }, [])

  const handleEditKnowledgeKeyword = useCallback((index: number, keyword: string) => {
    const nextKeyword = keyword.trim()
    if (!nextKeyword) return

    setKnowledgeKeywords(current => {
      if (index < 0 || index >= current.length) return current

      const seen = new Set<string>()
      return current
        .map((value, valueIndex) => (valueIndex === index ? nextKeyword : value))
        .filter(value => {
          const key = value.trim().replace(/\s+/g, '')
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        })
    })
  }, [])

  const handleSaveKnowledge = useCallback(() => {
    if (!selectedTask) {
      toast.warning('请先选择一条评论')
      return
    }

    const question = getAutoReplyMessageDetail(selectedTask.comment).trim()
    const content = knowledgeDraft.trim()
    const keywords = knowledgeKeywords

    if (!question || keywords.length === 0) {
      toast.warning('当前评论还不能生成关键词')
      return
    }
    if (!content) {
      toast.warning('知识内容不能为空')
      return
    }

    const nextRules = mergeAutoReplyKnowledgeRules(selectedConfig.comment.keywordReply.rules, {
      keywords,
      contents: [content],
    })
    updateAutoReplyConfig(selectedTask.accountId, {
      comment: { keywordReply: { rules: nextRules } },
    })
    if (!selectedConfig.comment.keywordReply.enable) {
      updateAutoReplyConfig(selectedTask.accountId, {
        comment: { keywordReply: { enable: true } },
      })
    }
    toast.success({
      title: '知识已保存',
      description: `已加入关键词：${keywords.join('、')}`,
      dedupeKey: `auto-reply-knowledge:${selectedTask.accountId}:${selectedTask.comment.msg_id}`,
    })
  }, [
    knowledgeDraft,
    knowledgeKeywords,
    selectedTask,
    selectedConfig.comment.keywordReply.enable,
    selectedConfig.comment.keywordReply.rules,
    toast,
    updateAutoReplyConfig,
  ])

  const handleSaveHistoryKeywordRule = useCallback(
    (draft: AutoReplyHistoryKeywordRuleDraft) => {
      const config = accountConfigById.get(draft.accountId)
      if (!config) {
        toast.warning('未找到对应账号配置')
        return
      }

      const nextRules = mergeAutoReplyKnowledgeRules(config.comment.keywordReply.rules, {
        keywords: draft.keywords,
        contents: draft.contents,
      })

      updateAutoReplyConfig(draft.accountId, {
        comment: {
          keywordReply: {
            enable: true,
            rules: nextRules,
          },
        },
      })
      toast.success({
        title: '规则已保存',
        description: `已加入 ${draft.keywords.join('、')}`,
        dedupeKey: `auto-reply-history-rule:${draft.accountId}:${draft.commentId}`,
      })
    },
    [accountConfigById, toast, updateAutoReplyConfig],
  )

  const selectedReply = selectedTask?.reply
  const selectedDisplayName = selectedComment
    ? getAutoReplyMessageDisplayName(selectedComment)
    : '未选择评论'
  const status = selectedTaskStatus ? WORKBENCH_STATUS_META[selectedTaskStatus] : undefined
  const sentDisabled = !selectedTask || !draft.trim() || selectedReply?.isSent || isSendingDraft
  const saveKnowledgeDisabled =
    !selectedTask || !knowledgeDraft.trim() || knowledgeKeywords.length === 0

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,0.92fr)_minmax(18rem,1.08fr)] gap-3 xl:grid-cols-[minmax(22rem,0.92fr)_minmax(28rem,1.08fr)] xl:grid-rows-1">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/70 shadow-[var(--shadow-card)]">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 bg-[var(--surface-muted)]/60 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">评论队列</h2>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {accountFilter === ALL_ACCOUNT_FILTER ? '全部账号' : selectedAccountName} ·
                {statusFilter ? WORKBENCH_STATUS_META[statusFilter].label : '待回复'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AutoReplyHistorySheet
                accounts={historyAccounts}
                defaultScope={accountFilter === ALL_ACCOUNT_FILTER ? 'all' : accountFilter}
                accountConfigs={accountConfigsForHistory}
                onSaveKeywordRule={handleSaveHistoryKeywordRule}
                triggerClassName="group h-8 w-8 shrink-0 border-border/70 bg-[var(--surface-elevated)]/85 p-0 text-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary"
              />
              <AccountQueueFilter
                value={accountFilter}
                options={filterAccountOptions.map(source => ({
                  accountId: source.accountId,
                  accountName: source.accountName,
                  platformLabel: source.platformLabel,
                  isListening: autoReplyContexts[source.accountId]?.isListening === 'listening',
                }))}
                onValueChange={setAccountFilter}
              />
            </div>
          </div>
          <WorkbenchStatusFilters
            value={statusFilter}
            counts={statusCounts}
            pendingCount={pendingCount}
            onValueChange={setStatusFilter}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleTaskRows.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Clock3 className="h-5 w-5" />
              <span>
                {isAnyVisibleAccountListening
                  ? statusFilter
                    ? `暂无${WORKBENCH_STATUS_META[statusFilter].label}评论`
                    : '暂无待回复评论'
                  : '开始任务后接收直播间评论'}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visibleTaskRows.map(({ task, status }) => (
                <ReplyTaskCard
                  key={task.taskKey}
                  comment={task.comment}
                  accountName={task.accountName}
                  platformLabel={task.platformLabel}
                  status={status}
                  selected={task.taskKey === selectedTask?.taskKey}
                  onSelect={() => setSelectedTaskKey(task.taskKey)}
                  nodeRef={node => {
                    itemRefs.current[task.taskKey] = node
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid min-h-0 grid-rows-[minmax(12rem,1fr)_auto] overflow-hidden rounded-lg border border-border/70 bg-card/70 shadow-[var(--shadow-card)]">
        <div className="grid min-h-0 grid-rows-[auto_1fr]">
          <div className="flex items-center justify-between border-b border-border/70 bg-[var(--surface-muted)]/60 px-3 py-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {selectedDisplayName}
                </h2>
                {selectedComment ? (
                  <Badge variant="neutral" className="h-5 rounded px-1.5 text-[11px]">
                    {selectedAccountName}
                  </Badge>
                ) : null}
                {selectedComment ? (
                  <Badge variant="info" className="h-5 rounded px-1.5 text-[11px]">
                    {selectedPlatformLabel}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status ? (
                <Badge variant={status.variant} className="h-6 rounded px-2 text-[11px]">
                  {status.label}
                </Badge>
              ) : null}
              <AutoReplyInsightsSheet
                accountName={selectedLiveControlContext?.accountName ?? selectedAccountName}
                currentAccountId={selectedAccountId}
                comments={selectedComments}
                replies={selectedReplies}
                historySessions={selectedHistorySessions}
                currentSessionId={selectedCurrentSessionId}
                currentSessionStartedAt={selectedCurrentSessionStartedAt}
                currentSessionEndedAt={selectedCurrentSessionEndedAt}
                clearHistory={clearSelectedHistory}
                onLocateComment={handleLocateComment}
                toast={toast}
                triggerClassName="h-8 gap-1 border-border/70 bg-[var(--surface-elevated)] px-2 text-xs text-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary"
              />
            </div>
          </div>

          <div ref={conversationScrollRef} className="min-h-0 overflow-y-auto px-3 py-3">
            {conversationMessages.length > 0 ? (
              <div className="space-y-3">
                {conversationMessages.map((message, index) => {
                  const previous = conversationMessages[index - 1]
                  const showMeta =
                    !previous ||
                    previous.role !== message.role ||
                    previous.author !== message.author ||
                    previous.replyKind !== message.replyKind ||
                    Boolean(message.isCurrentComment)

                  return (
                    <ConversationMessageBubble
                      key={message.id}
                      message={message}
                      showMeta={showMeta}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <MessageSquareText className="h-5 w-5" />
                <span>从左侧队列选择一条评论</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/70 bg-[var(--surface-muted)]/70 p-2">
          <div className="rounded-md border border-border/70 bg-[var(--surface-elevated)]/85 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <DatabaseZap className="h-4 w-4 text-primary" />
                回复依据
              </div>
              {selectedReply ? (
                <Badge
                  variant={selectedReply.autoSendBlockedReason ? 'warning' : 'info'}
                  className="h-5 rounded px-1.5 text-[11px]"
                >
                  {selectedReply.autoSendBlockedReason ? '待确认' : '已生成'}
                </Badge>
              ) : selectedConfiguredReplyContent ? (
                <Badge variant="info" className="h-5 rounded px-1.5 text-[11px]">
                  已配置
                </Badge>
              ) : null}
            </div>

            <div>
              <KnowledgeBasisBlock
                icon={<KeyRound className="h-3.5 w-3.5" />}
                label="推荐关键词"
                values={knowledgeKeywords}
                onEditValue={handleEditKnowledgeKeyword}
                onRemoveValue={handleRemoveKnowledgeKeyword}
                tone="primary"
              />
            </div>

            <Textarea
              value={knowledgeDraft}
              onChange={event => setKnowledgeDraft(event.target.value.slice(0, 120))}
              placeholder="输入要沉淀的回复知识"
              className="mt-3 min-h-[4.5rem] resize-none border-border/60 bg-background/35 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <StatusHint
                  selectedReply={selectedReply}
                  configuredReplyContent={selectedConfiguredReplyContent}
                  pendingCount={pendingCount}
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-primary"
                  disabled={!selectedReplyContent}
                  onClick={() => {
                    handleResetKnowledgeDraft()
                    toast.info('已恢复当前回复内容')
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  恢复内容
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setKnowledgeDraft('')}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  disabled={saveKnowledgeDisabled}
                  onClick={handleSaveKnowledge}
                >
                  保存知识
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-md border border-border/70 bg-[var(--surface-elevated)]/85 p-2">
            <Textarea
              value={draft}
              onChange={event => setDraft(event.target.value.slice(0, 80))}
              placeholder="回复观众或直接发评，Enter 一键发送"
              className="min-h-[5.25rem] resize-none border-border/70 bg-background/35 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary"
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSendDraft()
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={tone === 'precise' ? 'subtle' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs text-primary"
                  onClick={() => setTone('precise')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  精准
                </Button>
                <Button
                  type="button"
                  variant={tone === 'warm' ? 'subtle' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs text-primary"
                  onClick={() => setTone('warm')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  温和
                </Button>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{draft.length}/80</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs hover:text-primary"
                  disabled={sentDisabled}
                  onClick={() => void handleSendDraft()}
                >
                  <SendHorizontal className="h-3.5 w-3.5" />
                  <span className="max-w-28 truncate">
                    {selectedTask ? `发送到 ${selectedAccountName}` : '发送'}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
