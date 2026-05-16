import { lazy, Suspense } from 'react'

const MessageRichMarkdownContent = lazy(async () => {
  const module = await import('./MessageRichMarkdownContent')
  return { default: module.MessageRichMarkdownContent }
})

export function MessageRichContent({ content }: { content: string }) {
  return (
    <Suspense
      fallback={
        <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{content}</div>
      }
    >
      <MessageRichMarkdownContent content={content} />
    </Suspense>
  )
}
