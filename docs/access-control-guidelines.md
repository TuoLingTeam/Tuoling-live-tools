# 统一权限刷新规范文档

> 文档版本: 1.0  
> 最后更新: 2026-03-13  
> 适用范围: 所有涉及权限判断的前端开发

---

## 1. 权限系统架构概述

### 1.1 核心原则

```
┌─────────────────────────────────────────────────────────────────┐
│                     权限系统核心原则                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. 单一数据源 - AccessContext 是权限判断的唯一输入                │
│ 2. 响应式更新 - useAccessContext() 自动订阅状态变化               │
│ 3. 统一刷新   - 关键动作后必须调用 refreshUserStatus()            │
│ 4. 禁止绕过   - 不允许直接读取 user.plan / userStatus.plan        │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              权限控制系统架构                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Access Layer (权限层)                         │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │  AccessContext  │  │  AccessPolicy   │  │    AccessControl    │  │   │
│  │  │    (数据上下文)  │  │    (策略定义)    │  │    (决策控制核心)    │  │   │
│  │  └────────┬────────┘  └─────────────────┘  └─────────────────────┘  │   │
│  │           │                                                          │   │
│  │  ┌────────┴────────────────────────────────────────────────────┐    │   │
│  │  │  useAccessContext() - 响应式 Hook，订阅所有相关状态变化       │    │   │
│  │  │  useAccessCheck(feature) - 基于 useAccessContext 的权限检查   │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│         ┌────────────────────┼─────────────────────┐                        │
│         ▼                    ▼                     ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   gateStore  │    │   UI组件     │    │  业务逻辑    │                   │
│  │  (执行门控)   │    │  (显示控制)   │    │  (权限检查)  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 何时使用 useAccessContext()

### 2.1 必须使用场景

| 场景 | 示例 | 说明 |
|-----|------|-----|
| 显示用户套餐信息 | `access.plan` | 账户中心显示当前套餐 |
| 显示账号上限 | `access.maxLiveAccounts` | 显示可添加账号数量 |
| 显示到期时间 | `access.trialEndsAt` | 显示试用/套餐到期时间 |
| 判断是否为付费用户 | `access.isPaidUser` | 付费功能入口控制 |
| 判断功能权限 | `access.canUseAllFeatures` | 功能可用性判断 |

### 2.2 使用示例

```typescript
import { useAccessContext } from '@/domain/access'

function UserInfoCard() {
  // ✅ 正确：使用 useAccessContext 获取权限信息
  const access = useAccessContext()

  return (
    <div>
      <p>当前套餐: {access.plan}</p>
      <p>账号上限: {access.maxLiveAccounts === -1 ? '无限制' : access.maxLiveAccounts}</p>
      <p>到期时间: {access.trialEndsAt ? new Date(access.trialEndsAt).toLocaleDateString() : '无到期时间'}</p>
    </div>
  )
}
```

### 2.3 禁止直接读取的来源

```typescript
// ❌ 禁止：直接读取 authStore
const { user } = useAuthStore()
const plan = user?.plan  // 禁止！

// ❌ 禁止：直接读取 userStatus
const { userStatus } = useAuthStore()
const maxAccounts = userStatus?.max_accounts  // 禁止！

// ❌ 禁止：使用已废弃的函数
import { getEffectivePlan, getMaxLiveAccounts } from '@/constants/subscription'
const plan = getEffectivePlan(user?.plan)  // 禁止！

// ✅ 正确：统一使用 useAccessContext
const access = useAccessContext()
const { plan, maxLiveAccounts } = access
```

---

## 3. 何时调用 refreshUserStatus()

### 3.1 必须调用的场景

| 动作 | 调用时机 | 说明 |
|-----|---------|-----|
| 试用激活成功 | 立即调用 | 确保试用状态立即生效 |
| 礼品卡兑换成功 | 立即调用 | 确保套餐升级立即生效 |
| 套餐升级成功 | 立即调用 | 确保权限变更立即生效 |
| 套餐续费成功 | 立即调用 | 确保到期时间更新 |
| 手动刷新状态 | 用户触发 | 账户中心手动刷新按钮 |

### 3.2 调用示例

```typescript
import { useAuthStore } from '@/stores/authStore'

function GiftCardRedeemDialog() {
  const refreshUserStatus = useAuthStore(s => s.refreshUserStatus)

  const handleRedeem = async (code: string) => {
    const result = await redeemGiftCard(code)
    
    if (result.success) {
      // ✅ 正确：兑换成功后立即刷新用户状态
      await refreshUserStatus()
      console.log('[GiftCard] User status refreshed after redeem')
      
      toast.success('兑换成功！')
    }
  }
}
```

### 3.3 调用规范

```typescript
// ✅ 正确：使用 await 确保刷新完成
await useAuthStore.getState().refreshUserStatus()

// ❌ 错误：不使用 await 可能导致竞态
useAuthStore.getState().refreshUserStatus()

// ✅ 正确：添加日志便于调试
await refreshUserStatus()
console.log('[Action] User status refreshed')

// ✅ 正确：错误处理
try {
  await refreshUserStatus()
} catch (error) {
  console.error('[Action] Failed to refresh user status:', error)
}
```

---

## 4. 添加新功能权限的步骤

### 4.1 步骤清单

1. **在 AccessControl.ts 添加 FeatureType**

```typescript
export type FeatureType =
  | 'connectLiveControl'
  | 'aiAssistant'
  | 'autoReply'
  | 'autoMessage'
  | 'autoPopUp'
  | 'addLiveAccount'
  | 'useAllFeatures'
  | 'yourNewFeature'  // ← 新增
```

2. **在 AccessPolicy.ts 添加策略函数**

```typescript
export function canUseYourNewFeature(context: AccessContext): AccessDecision {
  // 未登录
  if (!context.isAuthenticated) {
    return {
      allowed: false,
      reason: '请先登录',
      action: 'login',
    }
  }

  // 付费用户允许
  if (context.isPaidUser) {
    return { allowed: true }
  }

  // 试用用户检查
  if (context.plan === 'trial' && context.trialActive && !context.trialExpired) {
    return { allowed: true }
  }

  // 默认拒绝
  return {
    allowed: false,
    reason: '需要开通试用或升级套餐',
    action: 'subscribe',
  }
}
```

3. **在 checkAccess 中添加 case**

```typescript
export function checkAccess(context: AccessContext, feature: FeatureType): AccessDecision {
  switch (feature) {
    // ... 现有 case
    
    case 'yourNewFeature':
      return Policy.canUseYourNewFeature(context)
    
    default:
      return { allowed: false, reason: '未知功能', action: 'none' }
  }
}
```

4. **在 UI 中使用**

```typescript
import { useAccessCheck } from '@/domain/access'

function NewFeatureButton() {
  const decision = useAccessCheck('yourNewFeature')

  return (
    <Button disabled={!decision.allowed}>
      {decision.reason || '使用新功能'}
    </Button>
  )
}
```

---

## 5. 调试权限问题的日志采集方法

### 5.1 关键日志点

| 日志点 | 位置 | 输出内容 |
|-------|------|---------|
| useAccessContext 重新计算 | `AccessControl.ts` | plan, trialEndsAt, maxLiveAccounts, isAuthenticated |
| refreshUserStatus 成功 | `authStore.ts` | user.plan, userStatus.plan, userStatus.max_accounts |
| 试用/兑换/升级成功 | 各组件 | 事件名, 刷新调用状态, 刷新后关键字段 |
| gateStore 门控 | `gateStore.ts` | actionName, decision.allowed, decision.reason |

### 5.2 浏览器 Console 过滤

```javascript
// 查看权限相关日志
console.filter('[useAccessContext]')
console.filter('[AuthStore]')
console.filter('[GiftCard]')
console.filter('[GateStore]')

// 查看所有权限日志
console.filter('Access')
```

### 5.3 问题排查流程

```
1. 确认 useAccessContext 是否重新计算
   → 查看 [useAccessContext] Recomputed 日志

2. 确认 refreshUserStatus 是否成功
   → 查看 [AuthStore] User status refreshed 日志

3. 确认 gateStore 决策是否正确
   → 查看 [GateStore] Access granted/denied 日志

4. 对比状态变化前后的值
   → 查看前后两次 [useAccessContext] 日志的差异
```

---

## 6. 常见错误和解决方案

### 6.1 错误：UI 显示与 gateStore 决策不一致

**现象**: 按钮可点击，但点击后被拦截  
**原因**: UI 和 gateStore 读取了不同的状态源  
**解决**: 统一使用 `useAccessCheck()` 或 `useAccessContext()`

```typescript
// ❌ 错误：UI 直接判断
disabled={user?.plan === 'trial'}

// ✅ 正确：使用统一权限检查
const decision = useAccessCheck('featureName')
disabled={!decision.allowed}
```

### 6.2 错误：状态更新后 UI 未刷新

**现象**: 试用激活/套餐升级后，UI 仍显示旧状态  
**原因**: `useAccessContext()` 未正确订阅状态变化  
**解决**: 确保 `useAccessContext()` 使用 Zustand selector 订阅

```typescript
// ✅ 正确：在 AccessControl.ts 中使用 selector
const userStatus = useAuthStore(s => s.userStatus)
```

### 6.3 错误：竞态条件导致状态不一致

**现象**: 快速操作时权限判断错误  
**原因**: 多个状态更新未同步完成  
**解决**: 使用 `await` 确保刷新完成

```typescript
// ✅ 正确：使用 await
await refreshUserStatus()

// ❌ 错误：可能导致竞态
refreshUserStatus()
```

### 6.4 错误：直接读取已废弃的函数

**现象**: 代码中使用了旧的权限判断函数  
**原因**: 未迁移到新的权限层  
**解决**: 迁移到 `useAccessContext()`

```typescript
// ❌ 错误：使用已废弃函数
import { getEffectivePlan } from '@/constants/subscription'

// ✅ 正确：使用新的权限层
const access = useAccessContext()
const plan = access.plan
```

---

## 7. 代码审查检查清单

### 7.1 新增功能审查

- [ ] 是否使用了 `useAccessContext()` 获取权限信息？
- [ ] 是否使用了 `useAccessCheck()` 进行权限判断？
- [ ] 是否在关键动作后调用了 `refreshUserStatus()`？
- [ ] 是否使用了 `await` 确保刷新完成？
- [ ] 是否添加了必要的调试日志？

### 7.2 重构审查

- [ ] 是否删除了直接读取 `user.plan` 的代码？
- [ ] 是否删除了直接读取 `userStatus.max_accounts` 的代码？
- [ ] 是否删除了对已废弃函数的调用？
- [ ] 是否确保所有权限判断都通过 AccessControl？

### 7.3 调试审查

- [ ] 是否添加了 DEV 模式下的调试日志？
- [ ] 日志是否包含关键字段（plan, maxLiveAccounts 等）？
- [ ] 错误处理是否完善？

---

## 8. 快速参考卡片

### 8.1 导入语句

```typescript
// 权限层
import { 
  useAccessContext, 
  useAccessCheck, 
  buildAccessContext,
  checkAccess 
} from '@/domain/access'

// Store
import { useAuthStore } from '@/stores/authStore'
```

### 8.2 常用模式

```typescript
// 模式1: 简单权限检查
const decision = useAccessCheck('featureName')

// 模式2: 获取完整权限上下文
const access = useAccessContext()

// 模式3: Store 中检查权限
const context = buildAccessContext()
const decision = checkAccess(context, 'featureName')

// 模式4: 刷新用户状态
await useAuthStore.getState().refreshUserStatus()
```

### 8.3 调试命令

```javascript
// 查看当前权限上下文
const access = JSON.parse(JSON.stringify(useAccessContext()))
console.table(access)

// 查看 authStore 状态
const state = useAuthStore.getState()
console.log('userStatus:', state.userStatus)
```

---

## 9. 附录

### 9.1 相关文件

```
src/domain/access/
├── AccessContext.ts      # 上下文定义
├── AccessControl.ts      # 控制核心（useAccessContext, checkAccess）
├── AccessPolicy.ts       # 策略定义
└── index.ts              # 统一导出

src/stores/
├── authStore.ts          # 认证状态（refreshUserStatus）
├── gateStore.ts          # 门控逻辑
└── trialStore.ts         # 试用状态

docs/
├── access-control-architecture.md  # 架构文档
└── access-control-guidelines.md    # 本规范文档
```

### 9.2 变更历史

| 日期 | 版本 | 变更 |
|-----|------|-----|
| 2026-03-13 | 1.0 | 初始版本，基于 Phase 4 重构成果 |

### 9.3 联系与支持

- 权限系统问题：查看本规范和架构文档
- 调试问题：参考第 5 节日志采集方法
- 新增功能：参考第 4 节步骤清单
