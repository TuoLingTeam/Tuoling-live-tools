import { BookOpen } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const UserGuideDialogContent = lazy(async () => {
  const module = await import('./UserGuideDialogContent')
  return { default: module.UserGuideDialogContent }
})

interface UserGuideDialogProps {
  trigger?: React.ReactNode
  className?: string
}

export function UserGuideDialog({ trigger, className }: UserGuideDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className={cn('gap-1.5', className)}>
            <BookOpen className="h-3.5 w-3.5" />
            使用教程
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5 text-primary" />
              使用教程
            </DialogTitle>
          </div>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6 py-4">
          {open ? (
            <Suspense
              fallback={<div className="py-8 text-sm text-muted-foreground">正在加载教程...</div>}
            >
              <UserGuideDialogContent />
            </Suspense>
          ) : null}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
