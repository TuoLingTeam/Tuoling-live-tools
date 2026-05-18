import { useEffect, useRef } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useToast } from '@/hooks/useToast'
import { useIsAuthenticated, useUser } from '@/stores/authStore'
import {
  beginTaskRecoverySession,
  heartbeatTaskRecoverySession,
  markTaskRecoverySessionClean,
  shouldRecoverPreviousTaskSession,
  TASK_RECOVERY_SESSION_HEARTBEAT_MS,
} from '@/utils/taskRecoveryManifest'
import { restoreRecoverableTasks } from '@/utils/taskRecoveryRestore'

const STARTUP_RECOVERY_DELAY_MS = 1200

export function useTaskRecovery() {
  const isAuthenticated = useIsAuthenticated()
  const user = useUser()
  const accounts = useAccounts(state => state.accounts)
  const { toast } = useToast()
  const startedSessionsRef = useRef<Set<string>>(new Set())
  const startupRecoveryRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return
    }

    const userId = user.id
    if (!startedSessionsRef.current.has(userId)) {
      startedSessionsRef.current.add(userId)
      beginTaskRecoverySession(userId)
    }

    heartbeatTaskRecoverySession(userId)

    const heartbeatTimer = window.setInterval(() => {
      heartbeatTaskRecoverySession(userId)
    }, TASK_RECOVERY_SESSION_HEARTBEAT_MS)

    const markClean = () => {
      markTaskRecoverySessionClean(userId)
    }

    window.addEventListener('beforeunload', markClean)

    return () => {
      window.clearInterval(heartbeatTimer)
      window.removeEventListener('beforeunload', markClean)
    }
  }, [isAuthenticated, user?.id])

  useEffect(() => {
    if (!isAuthenticated || !user?.id || accounts.length === 0) {
      return
    }

    const userId = user.id
    if (startupRecoveryRef.current.has(userId)) {
      return
    }

    startupRecoveryRef.current.add(userId)
    const timer = window.setTimeout(() => {
      if (!shouldRecoverPreviousTaskSession(userId)) {
        return
      }

      void restoreRecoverableTasks(userId, {
        reason: 'startup',
        callbacks: {
          info: message =>
            toast.info({
              title: '正在恢复任务',
              description: message,
              dedupeKey: `task-recovery-start:${userId}`,
            }),
          success: message =>
            toast.success({
              title: '任务已恢复',
              description: message,
              dedupeKey: `task-recovery-success:${userId}`,
            }),
          error: message =>
            toast.error({
              title: '任务恢复失败',
              description: message,
              dedupeKey: `task-recovery-error:${userId}:${message}`,
            }),
        },
      })
    }, STARTUP_RECOVERY_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [accounts.length, isAuthenticated, toast, user?.id])
}
