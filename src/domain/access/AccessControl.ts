/**
 * 权限控制核心 - AccessControl
 *
 * 提供统一权限检查入口和上下文构建器。
 * 这是权限层的门面(Facade)，对外暴露统一的权限API。
 */

import { useMemo } from 'react'
import { useAccounts } from '@/hooks/useAccounts'
import { useAuthStore } from '@/stores/authStore'
import type { AccessContext, AccessDecision } from './AccessContext'
import { createEmptyAccessContext } from './AccessContext'
import * as Policy from './AccessPolicy'
import type { PlanType } from './planRules'

const metaEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env

// ===== 功能类型枚举 =====

/**
 * 功能类型 - 所有需要权限控制的功能
 */
export type FeatureType =
  | 'connectLiveControl' // 连接直播中控台
  | 'aiAssistant' // AI助手
  | 'autoReply' // 自动回复
  | 'autoMessage' // 自动发言
  | 'autoPopUp' // 自动弹窗
  | 'addLiveAccount' // 添加直播账号
  | 'useAllFeatures' // 使用全部功能

// ===== 上下文构建器 =====

/**
 * 从各个 Store 构建统一权限上下文
 *
 * 这是唯一允许直接访问 authStore/trialStore/accounts 的地方。
 * 所有权限判断必须通过此函数获取上下文。
 *
 * @returns AccessContext 统一权限上下文
 */
export function buildAccessContext(): AccessContext {
  const authState = useAuthStore.getState()
  const accountsState = useAccounts.getState()

  const userStatus = authState.userStatus
  const user = authState.user
  const capabilities = userStatus?.capabilities ?? null

  // 服务端 userStatus.plan 作为套餐真相源；只有缺少 userStatus 时才回退到本地缓存用户信息。
  const effectivePlan = userStatus?.plan
    ? Policy.normalizePlan(userStatus.plan)
    : Policy.normalizePlan(user?.plan)

  // 判断试用状态（优先使用服务端状态）
  const trialActive = userStatus?.trial?.is_active ?? effectivePlan === 'trial'
  const trialExpired = userStatus?.trial?.is_expired ?? false
  const trialEndsAt = userStatus?.trial?.end_at ? new Date(userStatus.trial.end_at).getTime() : null

  // 计算正式套餐到期时间（优先使用 userStatus，其次 user.expire_at）
  const expiresAt = userStatus?.expire_at
    ? new Date(userStatus.expire_at).getTime()
    : user?.expire_at
      ? new Date(user.expire_at).getTime()
      : null

  // 计算功能权限
  const paidUser = capabilities?.is_paid_user ?? Policy.isPaidPlan(effectivePlan)
  const allFeatures = capabilities?.can_use_all_features ?? Policy.canUseAllFeatures(effectivePlan)

  // 获取账号上限（优先使用服务端返回的值）
  const maxAccounts =
    capabilities?.max_live_accounts ??
    userStatus?.max_accounts ??
    Policy.getMaxLiveAccounts(effectivePlan)

  // 【日志】仅开发环境打印，避免生产环境频繁输出
  if (metaEnv?.DEV === true) {
    console.log(
      '[AccessContext] effectivePlan=%s, trialActive=%s, trialExpired=%s, maxLiveAccounts=%s, source=%s',
      effectivePlan,
      trialActive,
      trialExpired,
      maxAccounts,
      userStatus ? 'userStatus' : 'default',
    )
  }

  return {
    isAuthenticated: authState.isAuthenticated,
    userId: user?.id ?? null,
    username: user?.username ?? null,
    plan: effectivePlan,
    userStatus,
    capabilities,
    trialActive,
    trialExpired,
    trialEndsAt,
    expiresAt,
    canUseAllFeatures: allFeatures,
    isPaidUser: paidUser,
    maxLiveAccounts: maxAccounts,
    currentAccountCount: accountsState.accounts.length,
    isDevEnvironment: metaEnv?.DEV === true,
  }
}

/**
 * 构建指定套餐的权限上下文（用于测试或预览）
 *
 * @param plan 指定套餐类型
 * @returns AccessContext 权限上下文
 */
export function buildAccessContextForPlan(plan: PlanType): AccessContext {
  const context = createEmptyAccessContext()

  context.isAuthenticated = true
  context.plan = plan
  context.isPaidUser = Policy.isPaidPlan(plan)
  context.canUseAllFeatures = Policy.canUseAllFeatures(plan)
  context.maxLiveAccounts = Policy.getMaxLiveAccounts(plan)

  return context
}

// ===== 统一权限检查入口 =====

/**
 * 统一权限检查入口
 *
 * 所有权限判断必须通过此函数完成。
 * 根据功能类型调用相应的策略函数。
 *
 * @param context 权限上下文
 * @param feature 功能类型
 * @returns AccessDecision 权限判断结果
 *
 * @example
 * ```typescript
 * const context = buildAccessContext()
 * const decision = checkAccess(context, 'connectLiveControl')
 * if (!decision.allowed) {
 *   showToast(decision.reason)
 * }
 * ```
 */
export function checkAccess(context: AccessContext, feature: FeatureType): AccessDecision {
  // 未登录状态快速返回
  if (!context.isAuthenticated && feature !== 'addLiveAccount') {
    return {
      allowed: false,
      reason: '请先登录',
      action: 'login',
    }
  }

  switch (feature) {
    case 'connectLiveControl':
      return Policy.canConnectLiveControl(context)

    case 'aiAssistant':
      return Policy.canUseAiAssistant(context)

    case 'autoReply':
      return Policy.canUseAutoReply(context)

    case 'autoMessage':
      return Policy.canUseAutoMessage(context)

    case 'autoPopUp':
      return Policy.canUseAutoPopUp(context)

    case 'addLiveAccount':
      return Policy.canAddMoreLiveAccounts(context)

    case 'useAllFeatures':
      if (context.canUseAllFeatures) {
        return { allowed: true }
      }
      return {
        allowed: false,
        reason: '当前套餐不支持使用全部功能',
        action: 'upgrade',
        requiredPlan: 'pro',
      }

    default:
      return {
        allowed: false,
        reason: '未知功能类型',
        action: 'none',
      }
  }
}

// ===== 便捷函数 =====

/**
 * 检查是否可以连接直播中控台（便捷函数）
 *
 * @param context 权限上下文
 * @returns boolean 是否允许
 */
export function canConnectLiveControl(context: AccessContext): boolean {
  return Policy.canConnectLiveControl(context).allowed
}

/**
 * 检查是否可以使用 AI 助手（便捷函数）
 *
 * @param context 权限上下文
 * @returns boolean 是否允许
 */
export function canUseAiAssistant(context: AccessContext): boolean {
  return Policy.canUseAiAssistant(context).allowed
}

/**
 * 检查是否可以添加更多直播账号（便捷函数）
 *
 * @param context 权限上下文
 * @returns boolean 是否允许
 */
export function canAddMoreLiveAccounts(context: AccessContext): boolean {
  return Policy.canAddMoreLiveAccounts(context).allowed
}

/**
 * 获取直播账号上限（便捷函数）
 *
 * @param context 权限上下文
 * @returns number 账号上限（-1表示无限制）
 */
export function getLiveAccountLimit(context: AccessContext): number {
  return Policy.getLiveAccountLimit(context)
}

/**
 * 检查是否为付费用户（便捷函数）
 *
 * @param context 权限上下文
 * @returns boolean 是否为付费用户
 */
export function isPaidUser(context: AccessContext): boolean {
  return Policy.isPaidUser(context)
}

/**
 * 获取有效套餐（便捷函数）
 *
 * @param context 权限上下文
 * @returns PlanType 有效套餐类型
 */
export function getEffectivePlanFromContext(context: AccessContext): PlanType {
  return context.plan
}

// ===== Hook 封装（供React组件使用） =====

/**
 * 使用权限上下文的 Hook
 *
 * 【修复】改造为真正响应式 Hook，订阅相关 store 状态变化
 * 确保当 userStatus / user / isAuthenticated 变化时自动重新计算
 *
 * @returns AccessContext 当前权限上下文
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const access = useAccessContext()
 *   return <div>当前套餐: {access.plan}</div>
 * }
 * ```
 */
export function useAccessContext(): AccessContext {
  // 订阅 authStore 的关键状态，确保变化时重新渲染
  const _isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const _user = useAuthStore(s => s.user)
  const _userStatus = useAuthStore(s => s.userStatus)

  // 订阅 accounts 状态
  const _accounts = useAccounts(s => s.accounts)

  void _accounts
  void _isAuthenticated
  void _user
  void _userStatus

  const context = buildAccessContext()

  // DEV 模式下输出调试日志
  if (metaEnv?.DEV === true) {
    console.log('[useAccessContext] Recomputed:', {
      plan: context.plan,
      trialEndsAt: context.trialEndsAt,
      maxLiveAccounts: context.maxLiveAccounts,
      isAuthenticated: context.isAuthenticated,
      timestamp: Date.now(),
    })
  }

  return context
}

/**
 * 使用权限检查的 Hook
 *
 * 【修复】使用响应式的 useAccessContext，确保状态变化时自动重新计算
 *
 * @param feature 功能类型
 * @returns AccessDecision 权限判断结果
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const decision = useAccessCheck('connectLiveControl')
 *   return (
 *     <Button disabled={!decision.allowed}>
 *       连接中控台
 *     </Button>
 *   )
 * }
 * ```
 */
export function useAccessCheck(feature: FeatureType): AccessDecision {
  const context = useAccessContext()
  return useMemo(() => checkAccess(context, feature), [context, feature])
}
