/** 云 API 用户映射为前端 SafeUser */
import type { CloudUserOut, SafeUser } from 'shared/auth'

export function cloudUserToSafeUser(u: CloudUserOut): SafeUser {
  const identifier = u.email ?? u.phone ?? u.id
  return {
    id: u.id,
    username: identifier,
    email: identifier,
    createdAt: u.created_at,
    lastLogin: u.last_login_at,
    status: u.status as 'active' | 'inactive' | 'banned',
    plan: 'trial',
    expire_at: null,
    deviceId: '',
    machineFingerprint: '',
    balance: 0,
  }
}
