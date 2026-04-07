import { useMemoizedFn } from 'ahooks'
import { SendIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { type AIChatContextMessage, useAIChatStore } from '@/hooks/useAIChat'
import { useAITrialStore } from '@/hooks/useAITrial'
import { useToast } from '@/hooks/useToast'
import { messagesToContext } from '@/lib/utils'

export default function ChatInput({
  onSubmit,
}: {
  onSubmit: (messages: AIChatContextMessage[]) => void
}) {
  const [input, setInput] = useState('')
  const status = useAIChatStore(state => state.status)
  const addMessage = useAIChatStore(state => state.addMessage)
  const messages = useAIChatStore(state => state.messages)
  const provider = useAIChatStore(state => state.config.provider)
  const apiKeys = useAIChatStore(state => state.apiKeys)
  const ensureTrialSession = useAITrialStore(state => state.ensureSession)
  const { toast } = useToast()

  const handleSubmit = useMemoizedFn(async () => {
    if (!apiKeys[provider]) {
      const trialSession = await ensureTrialSession('chat')
      if (!trialSession) {
        toast.error('请先配置 API Key 或启用体验模式')
        return
      }
    }
    if (!input.trim() || status !== 'ready') return

    const userMessage = input.trim()
    setInput('')
    addMessage({ role: 'user', content: userMessage })
    const contextMessages = messagesToContext(messages, userMessage)
    onSubmit(contextMessages)
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <>
      <Textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息，按 Enter 发送..."
        className="resize-none flex-1 min-h-[3.5rem] max-h-[12.5rem] bg-muted/50 focus:bg-background transition-colors"
        rows={3}
      />
      <Button
        size="icon"
        className="px-8 h-auto bg-primary hover:bg-primary/90"
        onClick={handleSubmit}
        disabled={!input.trim() || status !== 'ready'}
      >
        <SendIcon className="h-5 w-5" />
      </Button>
    </>
  )
}
