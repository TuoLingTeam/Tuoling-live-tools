import { normalizePlan } from '@/domain/access/planRules'
import type { SafeUser, UserStatus } from '@/types/auth'

type AuthStoreLike = {
  user: SafeUser | null
  userStatus: UserStatus | null
}

export function resolvePlanFromStatus(
  status: UserStatus | null | undefined,
  fallbackPlan?: string | null,
): SafeUser['plan'] {
  if (status?.plan) {
    return normalizePlan(status.plan)
  }
  return normalizePlan(fallbackPlan)
}

export function getUserIdentifiers(user: SafeUser | null | undefined): string[] {
  if (!user) return []
  return [user.id, user.username, user.phone, user.email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim())
}

export function doesStatusBelongToUser(
  status: UserStatus | null | undefined,
  user: SafeUser | null | undefined,
): boolean {
  if (!user) return false
  if (status?.user_id && user.id) {
    return status.user_id === user.id
  }
  if (!status?.username) return false
  return getUserIdentifiers(user).includes(status.username)
}

export function buildUserFromStatus(currentUser: SafeUser, status: UserStatus): SafeUser {
  const effectivePlan = resolvePlanFromStatus(status, currentUser.plan)
  const nextUsername = status.username || currentUser.username
  const isPhoneUsername = /^1[3-9]\d{9}$/.test(nextUsername)

  return {
    ...currentUser,
    id: status.user_id ?? currentUser.id,
    username: nextUsername,
    phone: isPhoneUsername ? nextUsername : currentUser.phone,
    plan: effectivePlan,
    expire_at: status.expire_at ?? null,
  }
}

export function applyUserStatusSnapshot<T extends AuthStoreLike>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: false) => void,
  get: () => T,
  status: UserStatus,
  logContext: string,
): boolean {
  const currentUser = get().user
  if (!doesStatusBelongToUser(status, currentUser)) {
    console.warn(`[AuthStore] Ignore stale user status during ${logContext}:`, {
      statusUserId: status.user_id ?? null,
      statusUsername: status.username,
      currentUserId: currentUser?.id ?? null,
      currentUser: currentUser?.username ?? null,
    })
    return false
  }

  set({
    userStatus: status,
    ...(currentUser ? { user: buildUserFromStatus(currentUser, status) } : {}),
  } as Partial<T>)
  return true
}
