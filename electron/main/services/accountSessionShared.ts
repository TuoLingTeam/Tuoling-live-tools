import type { createLogger } from '#/logger'

export type SessionLogger = ReturnType<typeof createLogger>

export type AccountSessionConnectState = Partial<{
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  phase:
    | 'idle'
    | 'preparing'
    | 'launching_browser'
    | 'waiting_for_login'
    | 'verifying_session'
    | 'streaming'
    | 'tasks_running'
    | 'error'
  error: string | null
  session: string | null
  lastVerifiedAt: number | null
}>

export type EmitConnectionState = (connectState: AccountSessionConnectState) => void

export type WithTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string) => Promise<T>

export type ConnectionTimeouts = {
  browserLaunchMs: number
  loginMs: number
  sessionVerifyMs: number
}
