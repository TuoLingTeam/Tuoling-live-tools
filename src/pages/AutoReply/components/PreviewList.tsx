import { SendHorizontalIcon } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useAccounts } from '@/hooks/useAccounts'
import { type MessageOf, useAutoReply } from '@/hooks/useAutoReply'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import AutoReplyInsightsSheet from './AutoReplyInsightsSheet'

const DEFAULT_VISIBLE_REPLY_COUNT = 120
const LOAD_MORE_REPLY_STEP = 120

const PreviewList = memo(function PreviewList({
  setHighLight,
}: {
  setHighLight: (commentId: string | null) => void
}) {
  const replyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const {
    replies,
    comments,
    historySessions,
    currentSessionId,
    currentSessionStartedAt,
    currentSessionEndedAt,
    markReplySent,
    clearHistory,
  } = useAutoReply()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const accountName = useCurrentLiveControl(ctx => ctx.accountName)
  const { toast } = useToast()
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_REPLY_COUNT)

  const questionTypeLabelMap: Record<'price' | 'stock' | 'usage' | 'general' | 'list', string> = {
    price: '价格问答',
    stock: '库存问答',
    usage: '商品介绍',
    general: '商品问答',
    list: '商品清单',
  }

  const missReasonLabelMap: Record<
    'no-items' | 'not-product-query' | 'slot-not-found' | 'reference-expired' | 'keyword-not-found',
    string
  > = {
    'no-items': '当前未配置商品知识卡',
    'not-product-query': '普通闲聊，未走商品知识库',
    'slot-not-found': '提到的链接号未配置',
    'reference-expired': '商品指代已过期',
    'keyword-not-found': '未匹配到商品关键词',
  }

  const handleSendReply = useCallback(
    async (replyContent: string, commentId: string) => {
      try {
        const sent = await window.ipcRenderer.invoke(
          IPC_CHANNELS.tasks.autoReply.sendReply,
          currentAccountId,
          replyContent,
        )
        if (sent) {
          markReplySent(commentId)
        }
      } catch (error) {
        console.error('发送回复失败:', error)
        toast.error('发送回复失败')
      }
    },
    [currentAccountId, markReplySent, toast],
  )

  const handleLocateComment = useCallback(
    (commentId: string) => {
      const scrollToTarget = () => {
        const target = replyRefs.current[commentId]
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      const targetIndex = replies.findIndex(reply => reply.commentId === commentId)
      if (targetIndex !== -1) {
        const minimumVisible = replies.length - targetIndex
        if (minimumVisible > visibleCount) {
          setVisibleCount(minimumVisible)
          requestAnimationFrame(scrollToTarget)
        } else {
          scrollToTarget()
        }
      } else {
        scrollToTarget()
      }
      setHighLight(commentId)
    },
    [replies, setHighLight, visibleCount],
  )

  const commentById = useMemo(
    () => new Map(comments.map(comment => [comment.msg_id, comment])),
    [comments],
  )
  const hiddenCount = Math.max(replies.length - visibleCount, 0)
  const visibleReplies = useMemo(() => replies.slice(-visibleCount), [replies, visibleCount])

  return (
    <Card className="shadow-sm flex h-full flex-col min-h-0 overflow-hidden">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">回复预览</CardTitle>
            <CardDescription className="text-xs">AI 生成的回复内容</CardDescription>
          </div>
          <AutoReplyInsightsSheet
            accountName={accountName}
            currentAccountId={currentAccountId}
            comments={comments}
            replies={replies}
            historySessions={historySessions}
            currentSessionId={currentSessionId}
            currentSessionStartedAt={currentSessionStartedAt}
            currentSessionEndedAt={currentSessionEndedAt}
            clearHistory={clearHistory}
            onLocateComment={handleLocateComment}
            toast={toast}
          />
        </div>
      </CardHeader>
      <Separator className="shrink-0" />
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          <div className="space-y-1 px-2">
            {hiddenCount > 0 ? (
              <div className="sticky top-0 z-10 mb-2 flex justify-center bg-background/95 py-1 backdrop-blur-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVisibleCount(current =>
                      Math.min(current + LOAD_MORE_REPLY_STEP, replies.length),
                    )
                  }
                >
                  加载更早的 {Math.min(hiddenCount, LOAD_MORE_REPLY_STEP)} 条回复
                </Button>
              </div>
            ) : null}
            {replies.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">暂无回复数据</div>
            ) : (
              visibleReplies.map(reply => {
                const relatedComment = commentById.get(reply.commentId) as MessageOf<'comment'>

                return (
                  <div
                    key={reply.commentId}
                    ref={node => {
                      replyRefs.current[reply.commentId] = node
                    }}
                    className="ui-hover-item group rounded-lg px-2 py-1.5 text-sm"
                    onMouseEnter={() => setHighLight(reply.commentId)}
                    onMouseLeave={() => setHighLight(null)}
                    onFocus={() => setHighLight(reply.commentId)}
                    onBlur={() => setHighLight(null)}
                  >
                    <div className="flex flex-col gap-0.5">
                      {relatedComment && (
                        <div className="text-xs text-muted-foreground">
                          回复：{relatedComment.nick_name} - {relatedComment.content}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {reply.source === 'product-kb' ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                            商品知识库
                            {reply.matchedSlotIndex ? ` · ${reply.matchedSlotIndex}号` : ''}
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5">AI 通用回复</span>
                        )}
                        {reply.isSent ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                            已发送
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">
                            待发送
                          </span>
                        )}
                        {reply.wasDeduplicated ? (
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-400">
                            已去重
                          </span>
                        ) : null}
                      </div>
                      {reply.source === 'product-kb' && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {reply.matchedTitle ? (
                            <span className="rounded-full bg-background/60 px-2 py-0.5">
                              {reply.matchedTitle}
                            </span>
                          ) : null}
                          {reply.questionType ? (
                            <span className="rounded-full bg-background/60 px-2 py-0.5">
                              {questionTypeLabelMap[reply.questionType]}
                            </span>
                          ) : null}
                          {reply.matchedFields?.map(field => (
                            <span key={field} className="rounded-full bg-background/60 px-2 py-0.5">
                              {field}
                            </span>
                          ))}
                        </div>
                      )}
                      {reply.source === 'ai' && reply.knowledgeMissReason && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="rounded-full bg-background/60 px-2 py-0.5">
                            回退通用 AI
                          </span>
                          <span className="rounded-full bg-background/60 px-2 py-0.5">
                            {missReasonLabelMap[reply.knowledgeMissReason]}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground/90 flex-1 leading-relaxed text-xs">
                          {reply.replyContent}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`发送回复给${relatedComment?.nick_name ?? '当前用户'}`}
                          className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                          disabled={reply.isSent}
                          onClick={() => handleSendReply(reply.replyContent, reply.commentId)}
                        >
                          <SendHorizontalIcon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

export default PreviewList
