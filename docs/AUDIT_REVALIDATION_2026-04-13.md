# 审计问题复核表（2026-04-13）

> 对照基线：
> - `docs/CODE_QUALITY_AUDIT_REPORT_2026-03.md`
> - 本轮分支实际代码与已落地测试

本文将旧审计项按当前状态分为三类：

- `已修`：代码或 CI 行为已与原问题描述明显不符
- `部分修`：核心风险已下降，但仍有残余问题或治理项未完成
- `仍待修`：原问题基本仍成立
- `待外部复查`：仓库内无法直接证明，需要远端仓库、镜像、历史分支或生产环境继续核查

## 1. 总结

- 安全高优先级项里，已经实质解决的主要是：
  前端敏感数据本地“加密”方案不足、主进程弱密钥兜底、依赖漏洞审计未纳入 CI。
- 架构与边界层里，已经明显改善的是：
  渲染层直接 IPC 暴露面大幅缩小；`src/` 下已无原始 `window.ipcRenderer.invoke/on/off/send(...)` 直连。
- 仍然待做的，主要集中在工程治理而不是单点漏洞：
  `noExplicitAny`、`scripts/` lint、测试 coverage 门禁、登录/注册限流、CORS 默认值、ADR、Storybook 等。

## 2. 逐项复核

### 2.1 代码质量

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| `noExplicitAny` 关闭 | `仍待修` | `biome.json` 中 `suspicious.noExplicitAny = "off"` | 目前仍允许新增 `any`。 |
| `scripts/` 被 Biome 忽略 | `仍待修` | `biome.json` 的 `files.includes` 里仍有 `!scripts` | Shell 语法检查已在 CI 中有单独 job，但 JS 脚本仍未纳入 Biome。 |
| 测试文件未纳入 TS 类型检查 | `仍待修` | `tsconfig.json` 的 `exclude` 仍包含 `**/*.test.ts`、`**/__tests__/**` | 目前测试类型错误仍可能绕过 `tsc --noEmit`。 |
| 缺少复杂度/高级静态分析 | `仍待修` | 仓库内未见 SonarQube / complexity budget / 覆盖阈值门禁 | 现有门禁以 Biome + `tsc` + 套件测试为主。 |

### 2.2 架构设计

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| `localhost` fallback 风险 | `部分修` | `src/config/authApiBase.ts`、`electron/main/config/buildTimeConfig.ts` 仍保留开发态 `localhost:8000` fallback；但 `scripts/validate-build-env.js`、`scripts/generate-build-config.js`、`.github/workflows/quality-gate.yml` 已把正式构建卡死在 `https://auth.xiuer.work` | 开发路径仍有 fallback，正式发布路径已受门禁保护。 |
| 生产 IP 硬编码 | `部分修` | `package.json` 已切到 `https://auth.xiuer.work`；但 `scripts/release-guard.js`、部分文档仍保留 `121.41.179.197` 作为历史/告警口径 | 运行路径已明显收敛，历史文档与门禁脚本里仍留有旧 IP 痕迹。 |
| 主进程/渲染层职责边界松散 | `部分修` | 本轮已新增 `authAPI`、`aiChatAPI`、`autoReplyAPI`、`autoPopUpAPI`、`autoMessageAPI`、`updateAPI`、`appAPI`、`chromeAPI`、`liveControlAPI`、`accountAPI`、`subAccountAPI`、`taskControlAPI`、`diagnosticsAPI`、`taskEventsAPI`、`taskIPC` 等 preload 封装 | 边界比旧报告时明显更清晰，但业务逻辑仍以渲染层为主，未完全下沉到 shared/main。 |

### 2.3 安全性

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| 无自动化依赖漏洞扫描 | `已修` | `.github/workflows/quality-gate.yml` 已包含 `npm audit` 与 `pip-audit` job；`package.json` 已有 `audit:npm` / `audit:pip` / `audit:deps` | 与旧报告结论已不一致。 |
| 前端敏感数据本地“加密”方案不足 | `已修` | `src/utils/encryption.ts`、`src/utils/storage/adapters/SecureStorageAdapter.ts` 已删除；AI key 已迁移到主进程 `AISecretsStorage`；当前代码中已无 `VITE_ENCRYPTION_KEY` 引用 | 原来那条 `XOR + 前端可见密钥 + 默认密钥` 路径已移除。 |
| CORS 默认 `*` | `部分修` | `auth-api/config.py` 默认仍为 `*`；但 `auth-api/main.py` 已在 wildcard 场景禁用 `allow_credentials` | 风险比旧报告小，但默认值仍偏宽。 |
| 登录/注册接口无全局速率限制 | `仍待修` | `auth-api/routers/sms.py` 有短信限流；未见 `/login`、`/register` 统一限流中间件或 slowapi | 认证接口暴力破解面仍未系统补齐。 |
| 管理员接口缺少代码级 IP 白名单 | `仍待修` | 代码中仍无 `ADMIN_ALLOWED_IPS` 一类实现；`auth-api/docs/ADMIN_RESET_PASSWORD.md` 已明确写出“当前代码未实现” | “文档误写为已实现”问题已修正，但控制本身仍未实现。 |
| `.env` 历史泄露未证实 | `待外部复查` | 仓库内仍无法直接证明是否曾在远端历史中提交 | 需要远端仓库、镜像、历史分支继续核查。 |
| `python-jose` 已弃用 | `已修` | 当前仓库搜索无 `python-jose` 依赖或代码使用；auth-api 使用 `jwt` | 此项对当前代码已不再成立。 |

### 2.4 性能

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| `chunkSizeWarningLimit = 1000KB` | `仍待修` | `vite.config.mts` 仍配置为 `1000` | 更像工程预算问题，不是阻断风险。 |
| 无 Lighthouse / 性能预算 | `仍待修` | 未见 Lighthouse CI / bundle budget / perf threshold | 与旧报告一致。 |
| Playwright 体积较大 | `仍待修` | 主进程仍携带 Playwright 运行时；仅安全基线已收紧（默认不再 `--no-sandbox`） | 体积问题未解决，但安全基线已有改善。 |

### 2.5 可维护性

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| 脚本语言混杂 | `仍待修` | 仓库中仍同时存在 `.js`、`.mjs`、`.cjs`、`.ts` 脚本 | 与旧报告一致。 |
| 无 ADR | `仍待修` | `docs/adr/` 目录仍不存在 | 与旧报告一致。 |

### 2.6 文档完整性

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| API 文档未自动化导出 | `仍待修` | FastAPI 自带 `/docs`，但仓库中未见静态导出流程 | 与旧报告一致。 |
| 个别文档与代码不一致 | `部分修` | `ADMIN_ALLOWED_IPS` 的文档已改为“当前未实现”；但文档体系仍较大，仍可能存在其他历史口径残留 | 已改善，但不宜宣称全部清完。 |
| Storybook 缺失 | `仍待修` | 仓库中无 Storybook 配置 | 与旧报告一致。 |

### 2.7 测试覆盖率

| 原审计项 | 当前状态 | 证据 | 说明 |
|---|---|---|---|
| Python 测试未全量纳入 CI | `已修` | `.github/workflows/quality-gate.yml` -> `npm run ci:auth` -> `auth:test`；`package.json` 中 `auth:test` 已覆盖 10+ Python unittest 文件 | 与旧报告结论已不一致。 |
| 测试文件数过低 | `部分修` | 当前本地代码内已存在 `51` 个 JS/TS 测试文件、`12` 个 Python 测试文件 | 数量已明显提升，但仍没有覆盖率阈值。 |
| 无 coverage 门禁 | `仍待修` | 未见 `vitest --coverage` 或 CI 覆盖率阈值配置 | 旧报告仍成立。 |
| 核心模块测试不足 | `部分修` | 近几轮已补 `auth` IPC、`aichat` IPC、`AccountManager.cleanup`、`accountSessionDisconnectOps`、`passwordPolicy`、`browserLaunchSecurity`、`AuthService.secret` 等测试 | 核心链路覆盖已经改善，但还没有达到“覆盖充分”。 |

## 3. 不在旧报告主表、但本轮已完成的关键修复

以下内容不一定都体现在 `docs/CODE_QUALITY_AUDIT_REPORT_2026-03.md` 的原表格里，但本轮已实质落地：

- 渲染层 `window.ipcRenderer` 直连已从 `src/` 业务代码中清零，统一收口到 preload API。
- 主窗口已显式设置 `sandbox: true`。
- Playwright 默认不再携带 `--no-sandbox`；仅在显式环境变量下才降级。
- `JWT_SECRET` 已增加最小长度约束（32+）。
- 密码策略已统一到 8 位最小长度，且登录路径未被错误地一刀切锁死。
- 退出链路已等待异步清理完成，`AccountManager.cleanup()` 不再是“发起后立即清空状态”的竞态。

## 4. 建议的下一批待办

按收益排序，建议下一批优先做：

1. 对 `/login`、`/register`、`/set-password`、`/change-password` 增加统一速率限制。  
2. 给前端和 Python 测试加 coverage 门禁。  
3. 决定是否真的需要管理员接口 IP 白名单；如果需要，就在代码中实现，而不是只停留在文档。  
4. 收紧 `scripts/` 质量门禁，并开始逐步恢复 `noExplicitAny`。  
5. 评估是否建立 `docs/adr/` 目录，把这次大规模 preload 收口和安全存储迁移记为正式架构决策。  
