import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { type Message, useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { cn } from '@/lib/utils'

const getMessageBadgeVariant = (type: Message['msg_type']): BadgeProps['variant'] => {
  switch (type) {
    case 'room_enter':
      return 'info'
    case 'room_like':
      return 'secondary'
    case 'room_follow':
      return 'secondary'
    case 'subscribe_merchant_brand_vip':
      return 'warning'
    case 'live_order':
      return 'success'
    case 'ecom_fansclub_participate':
      return 'warning'
    default:
      return 'neutral'
  }
}

const getMessageText = (message: Message) => {
  switch (message.msg_type) {
    case 'room_enter':
      return '进入直播间'
    case 'room_like':
      return '点赞了直播间'
    case 'room_follow':
      return '关注了直播间'
    case 'subscribe_merchant_brand_vip':
      return '加入了品牌会员'
    case 'live_order':
      return message.product_title
    case 'ecom_fansclub_participate':
      return '加入了粉丝团'
    default:
      return message.content
  }
}

const getMessageDetail = (message: Message) => {
  if ('content' in message && typeof message.content === 'string') {
    return message.content
  }
  return getMessageText(message)
}

const getMessageLabel = (type: Message['msg_type']) => {
  switch (type) {
    case 'room_enter':
      return '进入直播间'
    case 'room_like':
      return '点赞'
    case 'room_follow':
      return '关注'
    case 'subscribe_merchant_brand_vip':
      return '品牌会员'
    case 'live_order':
      return '下单'
    case 'ecom_fansclub_participate':
      return '粉丝团'
    default:
      return '评论'
  }
}

const getOrderStatusVariant = (status?: string): BadgeProps['variant'] => {
  switch (status) {
    case '已下单':
      return 'info'
    case '已付款':
      return 'success'
    default:
      return 'neutral'
  }
}

const MessageItem = memo(
  ({ message, isHighlighted }: { message: Message; isHighlighted: boolean }) => {
    const displayName = message.nick_name

    return (
      <div
        className={cn(
          'ui-hover-item flex items-start gap-3 rounded-lg px-3 py-2',
          isHighlighted ? 'border-primary/30 bg-primary/5 shadow-none' : '',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-muted-foreground">{displayName}</span>
            <Badge
              variant={getMessageBadgeVariant(message.msg_type)}
              className="px-2 py-0 text-[11px]"
            >
              {getMessageLabel(message.msg_type)}
            </Badge>
            {message.msg_type === 'live_order' && (
              <Badge
                variant={getOrderStatusVariant(message.order_status)}
                className="text-xs px-1.5 py-0"
              >
                {message.order_status}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{message.time}</span>
          </div>

          <div className="mt-0.5 text-sm">
            <p
              className={cn(
                'text-foreground/88',
                message.msg_type === 'live_order' ? 'font-medium' : '',
              )}
            >
              {message.msg_type === 'live_order'
                ? message.product_title
                : getMessageDetail(message)}
            </p>
          </div>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // 只有当 message.msg_id 或 isHighlighted 发生变化时才重新渲染
    return (
      prevProps.message.msg_id === nextProps.message.msg_id &&
      prevProps.isHighlighted === nextProps.isHighlighted
    )
  },
)

const DEFAULT_VISIBLE_COMMENT_COUNT = 200
const LOAD_MORE_COMMENT_STEP = 200

export default function CommentList({
  highlight: highlightedCommentId,
}: {
  highlight: string | null
}) {
  const { comments, isListening } = useAutoReply()
  const [hideHost, setHideHost] = useState(false)
  const commentRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const accountName = useCurrentLiveControl(ctx => ctx.accountName)

  // 纯文字评论类型
  const commentTypes: Message['msg_type'][] = [
    'comment',
    'wechat_channel_live_msg',
    'xiaohongshu_comment',
    'taobao_comment',
  ]

  const filteredComments = useMemo(() => {
    if (!hideHost) return comments

    // 开启"仅用户评论"时：过滤掉主播评论 + 只保留文字弹幕类型
    return comments.filter(
      comment => comment.nick_name !== accountName && commentTypes.includes(comment.msg_type),
    )
  }, [comments, hideHost, accountName, commentTypes.includes])
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COMMENT_COUNT)
  const hiddenCount = Math.max(filteredComments.length - visibleCount, 0)
  const visibleComments = useMemo(
    () => filteredComments.slice(-visibleCount),
    [filteredComments, visibleCount],
  )

  const statusLabel =
    isListening === 'listening'
      ? '监听中'
      : isListening === 'waiting'
        ? '连接中'
        : isListening === 'error'
          ? '连接异常'
          : '未监听'
  const statusVariant =
    isListening === 'listening'
      ? 'success'
      : isListening === 'waiting'
        ? 'warning'
        : isListening === 'error'
          ? 'destructive'
          : 'outline'

  const userCommentOnlyId = useId()

  useEffect(() => {
    if (!highlightedCommentId) return
    const targetIndex = filteredComments.findIndex(
      comment => comment.msg_id === highlightedCommentId,
    )
    if (targetIndex !== -1) {
      const minimumVisible = filteredComments.length - targetIndex
      if (minimumVisible > visibleCount) {
        setVisibleCount(minimumVisible)
        return
      }
    }
    const target = commentRefs.current[highlightedCommentId]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [filteredComments, highlightedCommentId, visibleCount])

  return (
    <Card className="shadow-sm flex h-full flex-col min-h-0 overflow-hidden">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">评论列表</CardTitle>
              <Badge variant={statusVariant} className="text-xs">
                {statusLabel}
              </Badge>
            </div>
            <CardDescription className="text-xs">实时显示直播间的评论内容</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {isListening === 'listening' && (
              <div className="flex items-center gap-1.5">
                <Switch id={userCommentOnlyId} checked={hideHost} onCheckedChange={setHideHost} />
                <Label htmlFor={userCommentOnlyId} className="text-xs">
                  仅用户评论
                </Label>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <Separator className="shrink-0" />
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          <div className="space-y-0.5 px-2">
            {hiddenCount > 0 ? (
              <div className="sticky top-0 z-10 mb-2 flex justify-center bg-background/95 py-1 backdrop-blur-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVisibleCount(current =>
                      Math.min(current + LOAD_MORE_COMMENT_STEP, filteredComments.length),
                    )
                  }
                >
                  加载更早的 {Math.min(hiddenCount, LOAD_MORE_COMMENT_STEP)} 条评论
                </Button>
              </div>
            ) : null}
            {filteredComments.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-muted-foreground text-sm">
                {isListening === 'listening'
                  ? '暂无评论数据'
                  : '请点击右上角"开始任务"开始接收评论'}
              </div>
            ) : (
              visibleComments.map(comment => (
                <div
                  key={comment.msg_id}
                  ref={node => {
                    commentRefs.current[comment.msg_id] = node
                  }}
                >
                  <MessageItem
                    message={comment}
                    isHighlighted={highlightedCommentId === comment.msg_id}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
