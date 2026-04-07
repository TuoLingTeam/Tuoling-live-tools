import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AIChatContextMessage, ChatMessage } from '@/hooks/useAIChat'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type ContextMessage = Pick<ChatMessage, 'role' | 'content' | 'isError'>

export function normalizeContextMessages(messages: ContextMessage[]) {
  const normalizedMessages: AIChatContextMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const currentMessage = messages[i]
    const nextMessage = messages[i + 1]

    // A failed round should not be sent upstream as part of the conversation history.
    if (currentMessage.role === 'user' && nextMessage?.isError) {
      i++
      continue
    }

    if (currentMessage.isError) {
      continue
    }

    if (!currentMessage.content.trim()) {
      continue
    }

    const previousMessage = normalizedMessages[normalizedMessages.length - 1]
    if (previousMessage?.role === currentMessage.role) {
      previousMessage.content = `${previousMessage.content}\n\n${currentMessage.content}`
      continue
    }

    normalizedMessages.push({
      role: currentMessage.role,
      content: currentMessage.content,
    })
  }

  return normalizedMessages
}

export function messagesToContext(messages: ChatMessage[], userMessage: string) {
  // 64k token 限制
  return [
    ...normalizeContextMessages(messages).slice(-100),
    { role: 'user' as const, content: userMessage },
  ]
}
