import { useDebounceEffect, useEventListener, useMemoizedFn } from 'ahooks'
import React, { useEffect, useRef } from 'react'
import { LoadingIcon } from '@/components/icons/loading'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type AIChatContextMessage, type ChatMessage, useAIChatStore } from '@/hooks/useAIChat'
import { getEffectiveAICredentials, useAITrialStore } from '@/hooks/useAITrial'
import ChatInput from './ChatInput'
import { Message } from './Message'

type ContextMessage = AIChatContextMessage

const useChatMessaging = () => {
  const status = useAIChatStore(state => state.status)
  const setStatus = useAIChatStore(state => state.setStatus)
  const markLastAssistantAsError = useAIChatStore(state => state.markLastAssistantAsError)
  const appendToChat = useAIChatStore(state => state.appendToChat)
  const appendToReasoning = useAIChatStore(state => state.appendToReasoning)
  const tryToHandleEmptyMessage = useAIChatStore(state => state.tryToHandleEmptyMessage)
  const provider = useAIChatStore(state => state.config.provider)
  const model = useAIChatStore(state => state.config.model)
  const apiKeys = useAIChatStore(state => state.apiKeys)
  const customBaseURL = useAIChatStore(state => state.customBaseURL)
  const reportTrialUse = useAITrialStore(state => state.reportUse)
  const autoScroll = useAIChatStore(state => state.autoScroll)
  const setAutoScroll = useAIChatStore(state => state.setAutoScroll)

  useEventListener('wheel', ev => {
    if (ev.deltaY < 0 && autoScroll && status === 'replying') {
      setAutoScroll(false)
    }
  })

  const handleStreamMessage = useMemoizedFn(
    ({
      chunk,
      type,
    }: {
      chunk: string
      type: string // content | reasoning
    }) => {
      setStatus('replying')
      if (type === 'content') {
        appendToChat(chunk)
      } else if (type === 'reasoning') {
        appendToReasoning(chunk)
      }
    },
  )

  const sendMessage = useMemoizedFn(async (messages: ContextMessage[]) => {
    setAutoScroll(true)
    let requestSucceeded = false
    return new Promise<void>((resolve, reject) => {
      setStatus('waiting')

      const removeStreamListener = window.aiChatAPI.onStream(result => {
        if ('done' in result && result.done) {
          requestSucceeded = true
          cleanup()
          resolve()
        } else if (
          'chunk' in result &&
          result.chunk &&
          (result.type === 'content' || result.type === 'reasoning')
        ) {
          handleStreamMessage({ chunk: result.chunk, type: result.type })
        }
      })

      const removeErrorHandler = window.aiChatAPI.onError(({ error }) => {
        cleanup()
        reject(error)
      })

      const cleanup = () => {
        removeStreamListener()
        removeErrorHandler()
      }

      const credentials = getEffectiveAICredentials({
        feature: 'chat',
        userProvider: provider,
        userModel: model,
        userApiKey: apiKeys[provider],
        userCustomBaseURL: customBaseURL,
      })

      if (!credentials) {
        cleanup()
        reject('请先配置 API Key 或启用体验模式')
        return
      }

      window.aiChatAPI
        .chat({
          messages,
          apiKey: credentials.apiKey,
          provider: credentials.provider,
          model: credentials.model,
          customBaseURL: credentials.customBaseURL,
        })
        .catch(error => {
          cleanup()
          reject(error)
        })
    })
      .catch(error => {
        markLastAssistantAsError(String(error))
      })
      .then(async () => {
        if (!requestSucceeded) {
          return
        }
        const credentials = getEffectiveAICredentials({
          feature: 'chat',
          userProvider: provider,
          userModel: model,
          userApiKey: apiKeys[provider],
          userCustomBaseURL: customBaseURL,
        })
        if (credentials?.credentialMode === 'trial') {
          await reportTrialUse({ feature: 'chat', model: credentials.model })
        }
      })
      .finally(() => {
        tryToHandleEmptyMessage('可能是网络请求超时，也可能是接收到了空数据')
        setStatus('ready')
      })
  })

  return {
    status,
    sendMessage,
  }
}

const useScrollToBottom = (messages: ContextMessage[]) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const autoScroll = useAIChatStore(state => state.autoScroll)

  useEventListener(
    'scroll',
    () => {
      if (viewportRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = viewportRef.current
        if (scrollHeight - scrollTop - clientHeight < 5) {
          useAIChatStore.getState().setAutoScroll(true)
        }
      }
    },
    { target: viewportRef },
  )

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport instanceof HTMLDivElement) {
        ;(viewportRef as { current: HTMLDivElement }).current = viewport
      }
    }
  }, [])

  useDebounceEffect(
    () => {
      if (viewportRef.current && autoScroll) {
        const scrollContainer = viewportRef.current
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    },
    [messages, autoScroll],
    { wait: 1, leading: true, trailing: true },
  )

  return { scrollAreaRef }
}

const MessageList = React.memo(
  ({
    messages,
    status,
    onRetry,
  }: {
    messages: ChatMessage[]
    status: string
    onRetry: (messages: AIChatContextMessage[]) => Promise<void>
  }) => (
    <div className="space-y-6 min-h-[6.25rem]">
      {messages.map(message => (
        <Message key={message.id} {...message} onRetry={onRetry} />
      ))}
      {status === 'waiting' && (
        <div className="flex justify-start">
          <LoadingIcon size="sm" />
        </div>
      )}
    </div>
  ),
)

export default function ChatBox() {
  const messages = useAIChatStore(state => state.messages)
  const { status, sendMessage } = useChatMessaging()
  const { scrollAreaRef } = useScrollToBottom(messages)

  return (
    <Card className="flex min-h-0 flex-1 flex-col border-none">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-0">
        <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 px-6 py-4">
          <MessageList messages={messages} status={status} onRetry={sendMessage} />
        </ScrollArea>

        <div className="flex gap-2 items-stretch p-4 border-t">
          <ChatInput onSubmit={sendMessage} />
        </div>
      </CardContent>
    </Card>
  )
}
