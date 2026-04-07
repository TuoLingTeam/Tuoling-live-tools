# 权限控制系统架构文档

> **版本**: v1.0
> **最后更新**: 2026-03-13
> **状态**: 已固化
> **负责人**: TEAM
> **当前适用性**: 当前有效
> **关联主文档**: 本文档为权限控制的唯一可信来源

---

> 重构阶段: Phase 4 完成

---

## 1. 架构概览

### 1.1 系统目标

建立统一的权限控制中心，解决以下问题：
- 权限判断分散在多个模块
- UI 显示与门控逻辑不一致
- 试用/付费逻辑覆盖关系混乱
- DEV 与生产环境行为不一致

### 1.2 架构原则

```
┌─────────────────────────────────────────────────────────────────┐
│                     权限控制核心原则                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. 单一数据源 - AccessContext 是权限判断的唯一输入                │
│ 2. 统一入口   - 所有权限检查通过 checkAccess()                    │
│ 3. 策略分离   - 业务规则在 Policy，决策逻辑在 Control            │
│ 4. 兼容迁移   - 旧 API 标记废弃后按计划删除                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              权限控制系统架构                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Access Layer (权限层)                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│  │  │ AccessContext│  │ AccessPolicy │  │      AccessControl       │  │   │
│  │  │   数据上下文  │  │   策略定义   │  │      决策控制核心         │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘  │   │
│  │         └─────────────────┴──────────────────────┘                  │   │
│  │                            │                                        │   │
│  │                    ┌───────┴───────┐                                │   │
│  │                    │   index.ts    │ 统一导出                       │   │
│  │                    └───────┬───────┘                                │   │
│  └────────────────────────────┼────────────────────────────────────────┘   │
│                               │                                             │
│         ┌─────────────────────┼─────────────────────┐                      │
│         ▼                     ▼                     ▼                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│  │   gateStore  │    │   UI组件     │    │  业务逻辑    │                 │
│  │  (执行门控)   │    │  (显示控制)   │    │  (权限检查)  │                 │
│  └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. AccessContext 结构

### 3.1 核心定义

```typescript
interface AccessContext {
  // ===== 认证状态 =====
  isAuthenticated: boolean      // 是否已登录
  userId: string | null         // 用户ID
  username: string | null       // 用户名

  // ===== 套餐信息 =====
  plan: PlanType                // 当前有效套餐
  userStatus: UserStatus | null // 服务端返回的用户状态

  // ===== 试用状态 =====
  trialActive: boolean          // 试用是否激活
  trialExpired: boolean         // 试用是否过期
  trialEndsAt: number | null    // 试用结束时间戳

  // ===== 功能权限 =====
  canUseAllFeatures: boolean    // 是否可使用全部功能
  isPaidUser: boolean           // 是否为付费用户

  // ===== 资源限制 =====
  maxLiveAccounts: number       // 最大直播账号数 (-1=无限制)
  currentAccountCount: number   // 当前账号数

  // ===== 环境信息 =====
  isDevEnvironment: boolean     // 是否开发环境
}
```

### 3.2 数据来源

```
AccessContext 数据来源:
├─ authStore.user          → userId, username
├─ authStore.userStatus    → plan, trialActive, trialExpired, maxLiveAccounts
├─ authStore.isAuthenticated → isAuthenticated
├─ trialStore              → (已整合到 userStatus)
├─ useAccounts().accounts  → currentAccountCount
└─ import.meta.env.DEV     → isDevEnvironment
```

### 3.3 构建方式

```typescript
// 方式1: 直接构建
const context = buildAccessContext()

// 方式2: React Hook
const context = useAccessContext()

// 方式3: 指定套餐构建（测试用）
const context = buildAccessContextForPlan('pro')
```

---

## 4. AccessControl 责任

### 4.1 核心职责

| 职责 | 说明 |
|-----|------|
| 上下文构建 | 从各 Store 聚合权限数据 |
| 统一检查 | 提供 `checkAccess(context, feature)` 入口 |
| 便捷函数 | 提供常用权限判断的简化 API |
| Hook 封装 | 提供 React 友好的 Hook 接口 |

### 4.2 功能类型 (FeatureType)

```typescript
type FeatureType =
  | 'connectLiveControl'   // 连接直播中控台
  | 'aiAssistant'          // AI助手
  | 'autoReply'            // 自动回复
  | 'autoMessage'          // 自动发言
  | 'autoPopUp'            // 自动弹窗
  | 'addLiveAccount'       // 添加直播账号
  | 'useAllFeatures'       // 使用全部功能
```

### 4.3 决策结果

```typescript
interface AccessDecision {
  allowed: boolean           // 是否允许
  reason?: string            // 拒绝原因
  action?: 'login' | 'subscribe' | 'upgrade' | 'none'  // 建议操作
  requiredPlan?: PlanType    // 需要升级的套餐
}
```

### 4.4 使用示例

```typescript
// 示例1: 基础权限检查
const context = buildAccessContext()
const decision = checkAccess(context, 'connectLiveControl')

if (!decision.allowed) {
  if (decision.action === 'login') {
    showLoginDialog()
  } else if (decision.action === 'subscribe') {
    showSubscribeDialog()
  }
}

// 示例2: React Hook
function MyComponent() {
  const decision = useAccessCheck('addLiveAccount')
  
  return (
    <Button disabled={!decision.allowed}>
      添加账号
    </Button>
  )
}

// 示例3: 便捷函数
const canAdd = canAddMoreLiveAccounts(context)
const limit = getLiveAccountLimit(context)
```

---

## 5. AccessPolicy 规则

### 5.1 套餐规则表

| 套餐 | 等级 | 账号上限 | 全功能 | 付费 |
|-----|------|---------|--------|-----|
| trial | 0 | 1 | ✅ | ❌ |
| pro | 1 | 1 | ✅ | ✅ |
| pro_max | 2 | 3 | ✅ | ✅ |
| ultra | 3 | -1(无限制) | ✅ | ✅ |

### 5.2 权限规则

#### 连接中控台 / AI助手 / 自动功能
```
条件: 已登录 AND (付费用户 OR 试用有效)

试用有效  → 允许
试用过期  → 拒绝, action='subscribe'
付费用户  → 允许
```

#### 添加直播账号
```
条件: 当前账号数 < 上限

trial/pro:    上限 1, 达上限后拒绝, action='upgrade'
pro_max:      上限 3, 达上限后拒绝, action='upgrade'
ultra:        无限制, 始终允许
```

### 5.3 策略函数

```typescript
// 套餐判断
isPaidPlan(plan): boolean
canUseAllFeatures(plan): boolean
getMaxLiveAccounts(plan): number
comparePlanLevel(planA, planB): number
meetsMinimumPlan(current, required): boolean
getEffectivePlan(plan, trialStatus): PlanType
getUpgradeSuggestion(currentPlan): PlanType | undefined

// 用户类型判断
isPaidUser(context): boolean
isActiveTrialUser(context): boolean
isFreeUser(context): boolean

// 功能权限判断
canConnectLiveControl(context): AccessDecision
canUseAiAssistant(context): AccessDecision
canAddMoreLiveAccounts(context): AccessDecision

// 资源限制
getLiveAccountLimit(context): number
getAccountLimitMessage(context): string
```

---

## 6. UI 使用方式

### 6.1 推荐模式

```typescript
// 模式1: 简单禁用控制
function ButtonWithGate() {
  const decision = useAccessCheck('connectLiveControl')
  
  return (
    <Button 
      disabled={!decision.allowed}
      onClick={handleClick}
    >
      连接中控台
    </Button>
  )
}

// 模式2: 显示提示信息
function ButtonWithTooltip() {
  const decision = useAccessCheck('addLiveAccount')
  
  return (
    <Tooltip content={decision.reason}>
      <Button disabled={!decision.allowed}>
        添加账号
      </Button>
    </Tooltip>
  )
}

// 模式3: 升级引导
function FeatureGate({ children, feature }) {
  const decision = useAccessCheck(feature)
  
  if (!decision.allowed && decision.action === 'upgrade') {
    return <UpgradePrompt requiredPlan={decision.requiredPlan} />
  }
  
  return children
}
```

### 6.2 禁止模式

```typescript
// ❌ 禁止直接判断
if (user.plan === 'pro') { ... }
if (trialStore.isInTrial()) { ... }
const max = getMaxLiveAccounts(user.plan)

// ✅ 必须使用权限层
const context = buildAccessContext()
const decision = checkAccess(context, feature)
```

---

## 7. gateStore 执行门控流程

### 7.1 流程图

```
用户点击功能按钮
       │
       ▼
┌──────────────┐
│ guardAction  │◄──────────────────┐
└──────┬───────┘                   │
       │                           │
       ▼                           │
┌──────────────┐                   │
│ buildAccess  │                   │
│   Context()  │                   │
└──────┬───────┘                   │
       │                           │
       ▼                           │
┌──────────────┐                   │
│ checkAccess  │                   │
│ (feature)    │                   │
└──────┬───────┘                   │
       │                           │
       ▼                           │
   decision                       │
   .allowed?                      │
       │                           │
   ┌───┴───┐                      │
   │       │                      │
   ▼       ▼                      │
  true   false                    │
   │       │                      │
   ▼       ▼                      │
 执行    根据                     │
操作    action                     │
        分发                      │
   ┌────┬───┴───┐                 │
   ▼    ▼       ▼                 │
 login subscribe upgrade          │
   │    │        │                │
   ▼    ▼        ▼                │
登录弹窗 试用弹窗 升级弹窗 ─────────┘
```

### 7.2 代码示例

```typescript
// gateStore.ts
guardAction: async (actionName, options) => {
  const context = buildAccessContext()
  
  // 映射 actionName 到 FeatureType
  const featureMap = {
    'connect-live-control': 'connectLiveControl',
    'ai-assistant': 'aiAssistant',
    'add-live-account': 'addLiveAccount',
    // ...
  }
  
  const feature = featureMap[actionName]
  const decision = checkAccess(context, feature)
  
  if (decision.allowed) {
    // 执行操作
    await pendingFn()
  } else {
    // 根据 action 类型处理
    switch (decision.action) {
      case 'login':
        showLoginDialog()
        break
      case 'subscribe':
        showSubscribeDialog()
        break
      case 'upgrade':
        showUpgradeDialog(decision.requiredPlan)
        break
    }
  }
}
```

---

## 8. 迁移状态

### 8.1 已完成迁移

| 模块 | 状态 | 说明 |
|-----|------|-----|
| src/domain/access/ | ✅ | 新权限层基础设施 |
| gateStore.ts | ✅ | 使用 checkAccess |
| useAccounts.ts | ✅ | 使用 checkAccess |
| AccountLimitDialog.tsx | ✅ | 使用 useAccessContext |
| UserCenter.tsx | ✅ | 使用 useAccessContext |

### 8.2 保留但标记废弃

| 文件 | 状态 | 说明 |
|-----|------|-----|
| subscription.ts | ⚠️ | 函数标记 @deprecated，保留类型定义 |
| authStore.ts | ⚠️ | 内部仍使用 getEffectivePlan，不修改 |
| AuthService.ts | ⚠️ | 后端服务，不修改 |

### 8.3 无需迁移

| 模块 | 说明 |
|-----|------|
| useLiveFeatureGate.ts | 运行时状态检查（连接/开播） |
| useRequireAuth.ts | 纯认证检查 |
| StatusCard.tsx | 使用 gateStore，已统一 |

---

## 9. 使用指南

### 9.1 新功能开发

```typescript
// 1. 导入权限层
import { useAccessCheck, buildAccessContext, checkAccess } from '@/domain/access'

// 2. 在组件中使用
function NewFeature() {
  const decision = useAccessCheck('yourFeature')
  
  return (
    <Button disabled={!decision.allowed}>
      {decision.reason || '使用新功能'}
    </Button>
  )
}

// 3. 在 Store 中使用
function someAction() {
  const context = buildAccessContext()
  const decision = checkAccess(context, 'yourFeature')
  
  if (!decision.allowed) {
    handleDenied(decision)
    return
  }
  
  // 执行业务逻辑
}
```

### 9.2 添加新功能权限

```typescript
// 1. 在 AccessControl.ts 添加 FeatureType
type FeatureType = 
  | 'existingFeature'
  | 'newFeature'  // 新增

// 2. 在 AccessPolicy.ts 添加策略函数
export function canUseNewFeature(context: AccessContext): AccessDecision {
  // 实现判断逻辑
}

// 3. 在 checkAccess 中添加 case
case 'newFeature':
  return Policy.canUseNewFeature(context)
```

---

## 10. 注意事项

### 10.1 重要原则

1. **禁止直接修改 AccessContext** - 它是只读的
2. **禁止绕过 AccessControl** - 所有权限判断必须通过 checkAccess
3. **兼容迁移有窗口** - 旧 API 标记废弃后应按计划删除
4. **统一数据来源** - 不要直接访问 authStore/trialStore

### 10.2 常见问题

**Q: 为什么 UI 和 gateStore 都要判断权限？**
A: UI 判断用于显示控制（禁用按钮、显示提示），gateStore 判断用于执行控制。两者使用相同的 AccessControl，保证一致性。

**Q: 如何处理权限变更？**
A: AccessContext 是实时构建的，每次调用 buildAccessContext() 都会获取最新状态。

**Q: 可以缓存 AccessContext 吗？**
A: 可以，但需要注意在权限变更时刷新。建议使用 React Hook 自动处理。

---

## 附录 A: 文件清单

```
src/domain/access/
├── AccessContext.ts      # 上下文定义
├── AccessControl.ts      # 控制核心
├── AccessPolicy.ts       # 策略定义
└── index.ts              # 统一导出

src/constants/subscription.ts  # 已标记废弃
src/stores/gateStore.ts        # 已迁移
src/hooks/useAccounts.ts       # 已迁移
src/components/common/AccountLimitDialog.tsx  # 已迁移
src/components/auth/UserCenter.tsx            # 已迁移

docs/access-control-architecture.md  # 本文档
```

## 附录 B: 变更历史

| 日期 | 阶段 | 变更 |
|-----|------|-----|
| 2026-03-13 | Phase 1 | 建立 AccessControl 基础设施 |
| 2026-03-13 | Phase 2 | 迁移 gateStore |
| 2026-03-13 | Phase 3 | 迁移 UI 权限入口 |
| 2026-03-13 | Phase 4 | 标记废弃旧 API，输出架构文档 |
