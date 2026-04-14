import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MIN_PASSWORD_LENGTH } from 'shared/passwordPolicy'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/useToast'
import { changePassword, setPassword } from '@/services/apiClient'

interface SetPasswordDialogProps {
  isOpen: boolean
  onClose: () => void
  /** true = 首次设置（无旧密码），false = 修改密码（需旧密码） */
  mode: 'set' | 'change'
}

export function SetPasswordDialog({ isOpen, onClose, mode }: SetPasswordDialogProps) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (isOpen) {
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowOld(false)
      setShowNew(false)
      setShowConfirm(false)
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少要 ${MIN_PASSWORD_LENGTH} 位`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一样，请重新输入')
      return
    }
    if (mode === 'change' && !oldPassword) {
      setError('请输入旧密码')
      return
    }

    setIsSubmitting(true)
    try {
      const result =
        mode === 'set'
          ? await setPassword(newPassword)
          : await changePassword(oldPassword, newPassword)

      if (result.ok) {
        toast.success({
          title: isSetMode ? '密码已设置' : '密码已修改',
          description: isSetMode ? '下次可以直接使用手机号和密码登录。' : '下次登录请使用新密码。',
          dedupeKey: isSetMode ? 'set-password-success' : 'change-password-success',
        })
        onClose()
      } else {
        const msg = result.error?.message || '操作没有成功，请稍后再试'
        setError(msg)
        toast.error({
          title: isSetMode ? '密码设置失败' : '密码修改失败',
          description: msg,
          dedupeKey: isSetMode ? 'set-password-failed' : 'change-password-failed',
        })
      }
    } catch {
      setError('操作没有成功，请稍后再试')
      toast.error({
        title: isSetMode ? '密码设置失败' : '密码修改失败',
        description: '操作没有成功，请稍后再试。',
        dedupeKey: isSetMode ? 'set-password-error' : 'change-password-error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const isSetMode = mode === 'set'

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        aria-describedby="set-password-description"
        className="w-full max-w-[26.25rem] rounded-xl border p-6"
        onPointerDownOutside={event => {
          if (isSubmitting) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={event => {
          if (isSubmitting) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader className="mb-5 text-center">
          <div className="mb-2 flex justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
          </div>
          <DialogTitle
            className="text-xl font-semibold"
            style={{
              color: 'var(--text-primary)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
          >
            {isSetMode ? '设置登录密码' : '修改密码'}
          </DialogTitle>
          <DialogDescription id="set-password-description">
            {isSetMode ? '设置密码后，下次可用手机号 + 密码直接登录' : '请输入旧密码和新密码'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-lg border border-destructive/20 p-3">
              <p role="alert" aria-live="polite" className="text-[13px] text-destructive">
                {error}
              </p>
            </div>
          )}

          {!isSetMode && (
            <div>
              <Label
                htmlFor="old-pwd"
                className="text-[13px]"
                style={{ color: 'var(--text-muted)' }}
              >
                旧密码
              </Label>
              <div className="relative mt-1">
                <Input
                  id="old-pwd"
                  type={showOld ? 'text' : 'password'}
                  placeholder="请输入旧密码"
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  className="h-10 rounded-lg text-sm pr-10"
                  style={{
                    backgroundColor: 'var(--input-bg)',
                    borderColor: 'var(--input-border)',
                    color: 'var(--text-primary)',
                  }}
                  required
                />
                <button
                  type="button"
                  aria-label={showOld ? '隐藏旧密码' : '显示旧密码'}
                  onClick={() => setShowOld(!showOld)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="new-pwd" className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {isSetMode ? '密码' : '新密码'}
            </Label>
            <div className="relative mt-1">
              <Input
                id="new-pwd"
                type={showNew ? 'text' : 'password'}
                placeholder={
                  isSetMode
                    ? `请设置密码（至少${MIN_PASSWORD_LENGTH}位）`
                    : `请输入新密码（至少${MIN_PASSWORD_LENGTH}位）`
                }
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="h-10 rounded-lg text-sm pr-10"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--input-border)',
                  color: 'var(--text-primary)',
                }}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <button
                type="button"
                aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label
              htmlFor="confirm-pwd"
              className="text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              确认{isSetMode ? '密码' : '新密码'}
            </Label>
            <div className="relative mt-1">
              <Input
                id="confirm-pwd"
                type={showConfirm ? 'text' : 'password'}
                placeholder="请再次输入密码"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="h-10 rounded-lg text-sm pr-10"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  borderColor: 'var(--input-border)',
                  color: 'var(--text-primary)',
                }}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <button
                type="button"
                aria-label={showConfirm ? '隐藏确认密码' : '显示确认密码'}
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-10 rounded-lg text-sm font-medium mt-4"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                提交中...
              </div>
            ) : isSetMode ? (
              '设置密码'
            ) : (
              '修改密码'
            )}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-[13px] text-muted-foreground hover:text-foreground h-auto p-0"
          >
            {isSetMode ? '稍后再说' : '取消'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
