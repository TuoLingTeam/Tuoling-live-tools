import {
  Bell,
  CheckCheck,
  ChevronRight,
  LoaderCircle,
  Megaphone,
  Pin,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useMessageCenterPolling, useMessageCenterStore } from '@/hooks/useMessageCenter'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

function formatMessageTime(value: string | null): string {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getMessageIcon(type: string) {
  switch (type) {
    case 'warning':
      return ShieldAlert
    case 'update':
      return RefreshCw
    case 'marketing':
      return Sparkles
    default:
      return Megaphone
  }
}

export const MessageCenterButton = memo(function MessageCenterButton() {
  useMessageCenterPolling()
  const navigate = useNavigate()

  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const items = useMessageCenterStore(state => state.items)
  const unreadCount = useMessageCenterStore(state => state.unreadCount)
  const isLoading = useMessageCenterStore(state => state.isLoading)
  const initialized = useMessageCenterStore(state => state.initialized)
  const streamConnected = useMessageCenterStore(state => state.streamConnected)
  const refresh = useMessageCenterStore(state => state.refresh)
  const markRead = useMessageCenterStore(state => state.markRead)
  const markAllRead = useMessageCenterStore(state => state.markAllRead)
  const [open, setOpen] = useState(false)
  const [isAttentionAnimating, setIsAttentionAnimating] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const previousUnreadRef = useRef<number | null>(null)
  const previousLatestUnreadIdRef = useRef<string | null>(null)
  const animationTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)

  const displayCount = useMemo(() => {
    if (unreadCount <= 0) return null
    return unreadCount > 99 ? '99+' : String(unreadCount)
  }, [unreadCount])

  const latestUnreadId = useMemo(() => items.find(item => !item.is_read)?.id ?? null, [items])

  useEffect(() => {
    const previousUnread = previousUnreadRef.current
    const previousLatestUnreadId = previousLatestUnreadIdRef.current
    const unreadIncreased = previousUnread !== null && unreadCount > previousUnread
    const latestUnreadChanged =
      previousLatestUnreadId !== null &&
      latestUnreadId !== null &&
      latestUnreadId !== previousLatestUnreadId

    previousUnreadRef.current = unreadCount
    previousLatestUnreadIdRef.current = latestUnreadId

    if (!initialized || !isAuthenticated || (!unreadIncreased && !latestUnreadChanged)) {
      return
    }

    if (animationTimerRef.current) {
      window.clearTimeout(animationTimerRef.current)
    }

    setIsAttentionAnimating(false)
    window.requestAnimationFrame(() => {
      setIsAttentionAnimating(true)
      animationTimerRef.current = window.setTimeout(() => {
        setIsAttentionAnimating(false)
        animationTimerRef.current = null
      }, 900)
    })
  }, [initialized, isAuthenticated, latestUnreadId, unreadCount])

  useEffect(() => {
    return () => {
      if (animationTimerRef.current) {
        window.clearTimeout(animationTimerRef.current)
      }
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setHighlightedMessageId(null)
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      return
    }

    const latestUnread = items.find(item => !item.is_read)
    if (!latestUnread) {
      setHighlightedMessageId(null)
      return
    }

    setHighlightedMessageId(latestUnread.id)
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(current => (current === latestUnread.id ? null : current))
      highlightTimerRef.current = null
    }, 1800)
  }, [items, open])

  if (!isAuthenticated) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="subtle"
          size="icon"
          className={cn(
            'relative h-9 w-9 rounded-lg',
            isAttentionAnimating && 'message-center-button--animate',
          )}
          aria-label="打开消息中心"
          title="消息中心"
        >
          <Bell className={cn('h-4 w-4', isAttentionAnimating && 'message-center-bell--animate')} />
          {displayCount && (
            <span
              className={cn(
                'absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground',
                isAttentionAnimating && 'message-center-badge--animate',
              )}
            >
              {displayCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[25rem] p-0">
        <div className="border-b border-border/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">消息中心</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {unreadCount > 0 ? `当前有 ${unreadCount} 条未读消息` : '当前没有未读消息'}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    streamConnected ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                />
                <span>{streamConnected ? '实时连接已建立' : '实时连接重连中'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  void refresh()
                }}
              >
                {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                刷新
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={unreadCount === 0}
                onClick={() => {
                  void markAllRead()
                }}
              >
                <CheckCheck />
                全部已读
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="max-h-[26rem]">
          <div className="p-2">
            {!initialized && isLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>正在加载消息...</span>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                暂无消息，服务器发布的新内容会出现在这里。
              </div>
            ) : (
              items.map(item => {
                const Icon = getMessageIcon(item.type)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-muted/60',
                      !item.is_read && 'bg-primary/5',
                      highlightedMessageId === item.id && 'message-center-item--highlight',
                    )}
                    onClick={() => {
                      void markRead(item.id)
                      setOpen(false)
                      navigate(`/messages?id=${encodeURIComponent(item.id)}`)
                    }}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        item.type === 'warning'
                          ? 'bg-amber-500/12 text-amber-600'
                          : item.type === 'update'
                            ? 'bg-sky-500/12 text-sky-600'
                            : item.type === 'marketing'
                              ? 'bg-emerald-500/12 text-emerald-600'
                              : 'bg-primary/10 text-primary',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {item.title}
                        </span>
                        {item.is_pinned && <Pin className="h-3.5 w-3.5 text-amber-600" />}
                        {!item.is_read && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                        {item.content}
                      </p>
                      <div className="mt-2 text-[11px] text-muted-foreground/80">
                        {formatMessageTime(item.published_at ?? item.created_at)}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>
        <div className="border-t border-border/70 p-2">
          <Button
            variant="ghost"
            className="w-full justify-between rounded-lg"
            onClick={() => {
              setOpen(false)
              navigate('/messages')
            }}
          >
            <span>查看全部消息</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
})
