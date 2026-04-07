import { RotateCw } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { AIChatContextMessage, ChatMessage } from '@/hooks/useAIChat'
import { useAIChatStore } from '@/hooks/useAIChat'
import { normalizeContextMessages } from '@/lib/utils'
import { MessageContent } from './MessageContent'

export function Message({
  id,
  role,
  content,
  reasoning_content,
  timestamp,
  isError,
  onRetry,
}: ChatMessage & {
  onRetry: (messages: AIChatContextMessage[]) => void
}) {
  const messages = useAIChatStore(state => state.messages)
  const setMessages = useAIChatStore(state => state.setMessages)

  // 判断是否显示重试按钮
  const showRetry = useMemo(() => {
    if (role !== 'user') return false
    const index = messages.findIndex(m => m.id === id)
    if (index === -1) return false

    for (let i = index + 1; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        break
      }
      if (messages[i].isError) {
        return true
      }
    }

    return false
  }, [messages, id, role])

  const handleRetry = useCallback(async () => {
    const currentIndex = messages.findIndex(m => m.id === id)
    if (currentIndex === -1) return

    const newMessages = [...messages]
    let deleteCount = 0

    for (let i = currentIndex + 1; i < newMessages.length; i++) {
      if (newMessages[i].role === 'user') {
        break
      }
      deleteCount++
    }

    if (deleteCount === 0) return

    newMessages.splice(currentIndex + 1, deleteCount)
    setMessages(newMessages)
    onRetry(normalizeContextMessages(newMessages))
  }, [messages, id, onRetry, setMessages])

  return role === 'user' ? (
    <UserMessage
      content={content}
      timestamp={timestamp}
      showRetry={showRetry}
      handleRetry={handleRetry}
    />
  ) : (
    <AssistantMessage
      content={content}
      reasoning_content={reasoning_content}
      timestamp={timestamp}
      isError={isError ?? false}
    />
  )
}

function UserMessage({
  content,
  timestamp,
  showRetry,
  handleRetry,
}: {
  content: string
  timestamp: number
  showRetry: boolean
  handleRetry: () => void
}) {
  return (
    <div className="relative flex justify-end group">
      {showRetry && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRetry}
          aria-label="重新发送这条消息"
          className="opacity-70 group-hover:opacity-100 transition-opacity hover:bg-transparent focus-visible:opacity-100"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      )}
      <div
        className="max-w-[85%] rounded-lg px-4 py-2 break-words shadow-sm bg-primary text-primary-foreground xl:max-w-[80%]"
        style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
      >
        <div className="whitespace-pre-wrap leading-relaxed text-[0.9375rem]">{content}</div>
        <div className="absolute -bottom-5 select-none right-1">
          <span className="text-[0.6875rem] text-primary/70">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  reasoning_content,
  timestamp,
  isError,
}: {
  content: string
  reasoning_content: string | undefined
  timestamp: number
  isError: boolean
}) {
  return (
    <div className="relative flex justify-start group">
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2 break-words shadow-sm xl:max-w-[80%] ${
          isError
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-muted text-foreground hover:bg-muted/80'
        }`}
        style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
      >
        <div className="whitespace-pre-wrap leading-relaxed text-[0.9375rem]">
          {reasoning_content && (
            <p className="text-muted-foreground text-[0.8125rem]">{reasoning_content}</p>
          )}
          {reasoning_content && content && <Separator className="my-2" />}
          <MessageContent content={content} />
        </div>
        <div className="absolute -bottom-5 select-none  left-1">
          <span className="text-[0.6875rem] text-muted-foreground/70">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}
