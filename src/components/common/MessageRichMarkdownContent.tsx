import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MessageRichMarkdownContent({ content }: { content: string }) {
  return (
    <div className="message-rich-content text-sm leading-7 text-foreground">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: props => <h1 className="mb-4 text-2xl font-semibold tracking-tight" {...props} />,
          h2: props => <h2 className="mb-3 mt-6 text-xl font-semibold tracking-tight" {...props} />,
          h3: props => <h3 className="mb-2 mt-5 text-lg font-semibold" {...props} />,
          p: props => <p className="mb-3 whitespace-pre-wrap text-sm leading-7" {...props} />,
          ul: props => <ul className="mb-4 list-disc space-y-1 pl-5 text-sm" {...props} />,
          ol: props => <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm" {...props} />,
          blockquote: props => (
            <blockquote
              className="mb-4 border-l-4 border-primary/30 bg-primary/5 px-4 py-3 text-sm text-muted-foreground"
              {...props}
            />
          ),
          a: props => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary underline underline-offset-4"
            />
          ),
          code: ({ className, children, ...props }) => (
            <code
              className={
                className
                  ? `${className} font-mono text-[13px]`
                  : 'rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground'
              }
              {...props}
            >
              {children}
            </code>
          ),
          pre: props => (
            <pre
              className="mb-4 overflow-x-auto rounded-xl border border-border/70 bg-muted/60 p-4 text-[13px] leading-6"
              {...props}
            />
          ),
          table: props => (
            <div className="mb-4 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: props => (
            <th
              className="border border-border/70 bg-muted px-3 py-2 text-left font-semibold"
              {...props}
            />
          ),
          td: props => <td className="border border-border/70 px-3 py-2 align-top" {...props} />,
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
