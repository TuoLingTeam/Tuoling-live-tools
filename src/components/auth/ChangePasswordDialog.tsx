import { Eye, EyeOff, Lock, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { MIN_PASSWORD_LENGTH } from 'shared/passwordPolicy'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/useToast'
import { changePassword } from '@/services/apiClient'

interface ChangePasswordDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function ChangePasswordDialog({ isOpen, onClose }: ChangePasswordDialogProps) {
  const { toast } = useToast()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const resetForm = useCallback(() => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowOldPassword(false)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [onClose, resetForm])

  const validateForm = useCallback(() => {
    if (!oldPassword.trim()) {
      toast.warning({
        title: '请输入旧密码',
        description: '填写当前密码后才能继续修改。',
        dedupeKey: 'change-password-old-required',
      })
      return false
    }
    if (!newPassword.trim()) {
      toast.warning({
        title: '请输入新密码',
        description: '填写新密码后才能继续修改。',
        dedupeKey: 'change-password-new-required',
      })
      return false
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.warning({
        title: '新密码过短',
        description: `新密码长度至少为 ${MIN_PASSWORD_LENGTH} 位。`,
        dedupeKey: 'change-password-too-short',
      })
      return false
    }
    if (newPassword !== confirmPassword) {
      toast.warning({
        title: '两次密码不一致',
        description: '请重新确认两次输入的新密码。',
        dedupeKey: 'change-password-mismatch',
      })
      return false
    }
    if (oldPassword === newPassword) {
      toast.warning({
        title: '新旧密码不能相同',
        description: '请设置一个不同于旧密码的新密码。',
        dedupeKey: 'change-password-same',
      })
      return false
    }
    return true
  }, [oldPassword, newPassword, confirmPassword, toast])

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return

    setIsLoading(true)
    try {
      const result = await changePassword(oldPassword, newPassword)
      if (result.ok) {
        toast.success({
          title: '密码已修改',
          description: '下次登录请使用新密码。',
          dedupeKey: 'change-password-success',
        })
        handleClose()
      } else {
        toast.error({
          title: '密码修改失败',
          description: result.error?.message || '密码修改失败，请稍后重试。',
          dedupeKey: 'change-password-failed',
        })
      }
    } catch {
      toast.error({
        title: '密码修改失败',
        description: '密码修改失败，请稍后重试。',
        dedupeKey: 'change-password-error',
      })
    } finally {
      setIsLoading(false)
    }
  }, [oldPassword, newPassword, validateForm, handleClose, toast])

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent
        aria-labelledby="change-password-title"
        aria-describedby="change-password-description"
        className="w-[24rem] max-w-[92vw] overflow-hidden rounded-2xl border p-0"
        onPointerDownOutside={event => {
          if (isLoading) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={event => {
          if (isLoading) {
            event.preventDefault()
          }
        }}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 border-b border-[hsl(var(--border))]">
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-all duration-200 p-2 rounded-lg hover:bg-muted"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 id="change-password-title" className="text-lg font-bold text-foreground">
                修改密码
              </h2>
              <p id="change-password-description" className="text-sm text-muted-foreground">
                请确保新密码安全性
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* 旧密码 */}
          <div className="space-y-2">
            <Label htmlFor="old-password">旧密码</Label>
            <div className="relative">
              <Input
                id="old-password"
                type={showOldPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                placeholder="请输入旧密码"
                className="pr-10"
                disabled={isLoading}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    document.getElementById('new-password')?.focus()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowOldPassword(!showOldPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={showOldPassword ? '隐藏密码' : '显示密码'}
              >
                {showOldPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* 新密码 */}
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={`请输入新密码（至少${MIN_PASSWORD_LENGTH}位）`}
                className="pr-10"
                disabled={isLoading}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    document.getElementById('confirm-password')?.focus()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={showNewPassword ? '隐藏密码' : '显示密码'}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* 确认新密码 */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">确认新密码</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
                className="pr-10"
                disabled={isLoading}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleSubmit()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* 密码要求提示 */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>密码要求：</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li className={newPassword.length >= MIN_PASSWORD_LENGTH ? 'text-emerald-300' : ''}>
                至少{MIN_PASSWORD_LENGTH}个字符
              </li>
              <li className={newPassword !== oldPassword && newPassword ? 'text-emerald-300' : ''}>
                不能与旧密码相同
              </li>
              <li
                className={newPassword === confirmPassword && newPassword ? 'text-emerald-300' : ''}
              >
                两次输入一致
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleClose} disabled={isLoading}>
            取消
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                修改中...
              </div>
            ) : (
              '确认修改'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
