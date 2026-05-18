# 秀儿直播助手 - 发布规范 v2.7

> **当前正式版本**: v1.6.7（发布准备中）
> **当前正式 API 基线**: `https://auth.xiuer.work`  
> **最后更新**: 2026-05-18
> **版本主题**: v1.6.7 聚焦渲染进程崩溃后的自动重连、任务自动恢复，以及直播控制稳定性加固
> **历史版本**: 
> - v1.6.7: 发布准备中
> - v1.6.6: 上一稳定版本
> - v1.6.5: 上一稳定版本
> - v1.6.3: 历史稳定版本
> - v1.6.2: 历史稳定版本
> - v1.6.0: 已发布但首次 Windows 构建失败，保留为历史记录
> - v1.5.3: 已发布但 CI Python 安全门禁未全绿，保留为历史记录
> - v1.5.2: 已发布但 CI npm audit 门禁未全绿，保留为历史记录
> - v1.5.1: 上一稳定版本
> - `http://121.41.179.197:8000`: 旧应急基线，现已退役，仅作历史记录保留

---

## 三层发布结构

本规范明确区分三种构建场景，避免"测试构建"和"正式发布构建"的混淆。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        发布规范三层结构                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  A. macOS 本地测试构建（当前项目使用）                                     │
│     ├── 目的：开发调试、内部测试、公开发布                                  │
│     ├── 签名：无（未签名应用）                                            │
│     ├── 公证：跳过                                                        │
│     ├── 限制：Gatekeeper 会阻止运行，需右键"打开"或禁用 Gatekeeper       │
│     └── 命令：npm run build && npx electron-builder --mac --publish never │
│                                                                         │
│  B. macOS 正式发布构建（未来可升级）                                       │
│     ├── 目的：向终端用户分发（无 Gatekeeper 限制）                          │
│     ├── 签名：必需（Apple Developer ID）                                 │
│     ├── 公证：必需（Apple Notary Service）                               │
│     ├── 限制：无（用户可正常安装运行）                                     │
│     └── 环境变量：APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   │
│                                                                         │
│  C. 推荐发布环境                                                          │
│     ├── macOS 构建：本地 Mac（任何 Apple Silicon 或 Intel Mac 均可）      │
│     ├── Windows 构建：GitHub Actions（windows-latest）                   │
│     └── 原因：Windows 构建依赖 Windows 特定工具链，GitHub Actions 更可靠  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 发布架构与职责边界

### 核心原则

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        发布架构与职责边界                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  【本地 Mac 职责】                                                        │
│  ├── 构建 macOS 安装包                                                   │
│  ├── 上传到 GitHub Release                                               │
│  └── ❌ 不再依赖 OSS 正式凭证（本地无需配置阿里云密钥）                      │
│                                                                         │
│  【GitHub Actions 职责】                                                  │
│  ├── 构建 Windows 安装包                                                 │
│  ├── 上传 Windows 产物到 GitHub Release                                  │
│  ├── 同步 Windows 产物到 OSS/CDN                                         │
│  ├── 同步 macOS 产物到 OSS/CDN（通过 upload-mac-oss workflow）            │
│  └── ✅ OSS 凭证统一由 GitHub Secrets 管理                                │
│                                                                         │
│  【手工兜底方案】                                                          │
│  └── npm run upload:mac:oss 保留，仅在当地有 OSS 凭证时作为备用方案         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 标准发布流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        标准发布流程                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  步骤 1: 发布准备（冻结前检查）                                             │
│  ├── npm run publish                                                     │
│  ├── 运行 release:audit / release:guard                                  │
│  ├── 本地构建 macOS 安装包                                                │
│  └── 生成 release-notes 与本地 mac 产物                                   │
│                                                                         │
│  步骤 2: 推送 main 并等待主线 CI 通过                                      │
│  ├── git push origin main                                                │
│  ├── 等待 Quality Gate 变绿                                               │
│  └── 确认主线不存在阻塞性 CI 问题                                          │
│                                                                         │
│  步骤 3: 创建 tag 并打开 draft Release                                    │
│  ├── npm run publish:confirm                                             │
│  ├── git push origin v<version>                                          │
│  └── gh release create v<version> --draft                                │
│                                                                         │
│  步骤 4: 并行编排平台资产                                                 │
│  ├── npm run publish:orchestrate                                         │
│  ├── 上传本地 mac 产物到 draft Release                                    │
│  └── 按需触发 Upload Mac to OSS                                          │
│                                                                         │
│  步骤 5: Windows 构建（自动触发）                                          │
│  ├── 触发: build-windows.yml                                             │
│  ├── 构建: .exe + .zip + latest.yml                                      │
│  ├── 上传: draft GitHub Release                                          │
│  └── 同步: OSS/CDN (Windows 产物)                                        │
│                                                                         │
│  步骤 6: 发布后纯验收                                                      │
│  ├── npm run publish:verify                                              │
│  ├── 验证: xiuer.work 首页版本与 package.json 一致                         │
│  ├── 验证: download.xiuer.work 所有资源可访问                              │
│  ├── 验证: latest.yml / latest-mac.yml 与 Release 资产一致                 │
│  └── 验证: GitHub Release 资产完整                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 发布时序强制要求

为避免“tag 已推送，但主线 CI 或 Windows 构建问题稍后才暴露”的情况，正式发布必须遵守以下顺序：

1. 先完成 `publish` 阶段，冻结版本、release-notes 和本地 mac 产物
2. 再推送 `main`
3. 等待 `Quality Gate` 变绿
4. 确认没有阻塞性的主线 CI 问题
5. 再创建并推送正式 tag
6. 立即创建 `draft Release` 作为统一资产汇总点

禁止再采用“先打 tag，再观察主线 CI”的流程。

---

## A. macOS 本地测试构建详解（当前项目使用）

### 适用场景
- 开发阶段快速验证
- 内部团队测试
- **公开发布（当前项目采用此方式）**

### 当前项目发布方式
> **注意**：当前项目使用"无签名测试构建"方式发布 macOS 版本。
> 
> 这意味着：
> - ✅ 任何 Mac（Intel / Apple Silicon）均可构建
> - ✅ 无需 Apple Developer 证书
> - ✅ 无需公证
> - ⚠️ 用户安装时需右键"打开"或按文档指引操作
> 
> **未来可升级**：如有需要，可后续配置 Apple Developer 签名和公证。

### 构建条件
| 条件 | 要求 | 说明 |
|------|------|------|
| 操作系统 | macOS 10.15+ | **任何 Mac 均可**（Intel / Apple Silicon） |
| Xcode | 不需要 | 无需安装 Xcode |
| 证书 | 不需要 | 生成未签名应用 |
| 公证 | 不需要 | 跳过公证流程 |

### 构建命令
```bash
# 基础测试构建（无签名）
npm run build
npx electron-builder --mac --publish never

# 或使用脚本（跳过阻断检查中的证书检查）
npm run release:mac
```

### 运行测试包
由于未签名，macOS Gatekeeper 会阻止运行：

```bash
# 方法 1：右键"打开"（推荐）
# 在 Finder 中找到 .app，右键 → 打开

# 方法 2：xattr 移除隔离属性
xattr -rd com.apple.quarantine "/path/to/秀儿直播助手.app"

# 方法 3：临时禁用 Gatekeeper（不推荐长期使用）
sudo spctl --master-disable
# 使用完后重新启用
sudo spctl --master-enable
```

---

## B. macOS 正式发布构建详解（未来可升级）

### 适用场景
- 向终端用户发布
- 需要自动更新功能
- **完全避免 Gatekeeper 拦截**

### 说明
> 这是**未来可升级**的发布方式，当前项目尚未使用。
> 
> 如需升级到此方式，需要：
> 1. 注册 Apple Developer 账号（$99/年）
> 2. 申请 Developer ID 证书
> 3. 配置签名和公证环境变量

### 构建条件
| 条件 | 要求 | 说明 |
|------|------|------|
| 操作系统 | macOS 10.15+ | **任何 Mac 均可**（Intel / Apple Silicon） |
| Xcode | 不需要 | 仅需命令行工具 |
| Apple ID | 必需 | 开发者账号 |
| 证书 | 必需 | Developer ID Application |
| 公证 | 必需 | 自动进行 |

### 环境变量配置
```bash
# 必需：Apple ID（开发者账号邮箱）
export APPLE_ID="your-email@example.com"

# 必需：App 专用密码（非 Apple ID 密码）
# 生成方式：appleid.apple.com → 安全 → App 专用密码
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# 必需：Team ID
# 查看方式：developer.apple.com → Account → Membership
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### 构建命令
```bash
# 设置环境变量后执行
export APPLE_ID="your-email@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"

npm run release:mac
```

### 验证签名和公证
```bash
# 检查签名
codesign -dv --verbose=4 "/path/to/秀儿直播助手.app"

# 检查公证状态
spctl -a -vv "/path/to/秀儿直播助手.app"

# 检查公证票证
xcrun stapler validate "/path/to/秀儿直播助手.app"
```

---

## C. 推荐发布环境

### 当前项目配置
```
┌─────────────────────────────────────────────────────────────┐
│                     推荐发布架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐         ┌──────────────────────┐         │
│  │  本地 Mac    │         │   GitHub Actions     │         │
│  │  (任意 Mac)  │         │   (windows-latest)   │         │
│  └──────┬───────┘         └──────────┬───────────┘         │
│         │                            │                     │
│         ▼                            ▼                     │
│  ┌──────────────┐         ┌──────────────────────┐         │
│  │  macOS 安装包 │         │   Windows 安装包     │         │
│  │     .dmg     │         │   .exe / .zip        │         │
│  └──────┬───────┘         └──────────┬───────────┘         │
│         │                            │                     │
│         └────────────┬───────────────┘                     │
│                      ▼                                      │
│           ┌────────────────────┐                           │
│           │   GitHub Releases   │                           │
│           │  统一分发平台       │                           │
│           └────────────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 为什么 Windows 用 GitHub Actions？
1. **工具链依赖**：Windows 构建需要 Windows 特定工具（如 electron-winstaller）
2. **环境一致性**：避免"在我机器上能跑"问题
3. **并行构建**：与 macOS 构建并行，节省时间
4. **自动发布**：构建完成后自动上传到 GitHub Release

### 为什么 macOS 用本地构建？
1. **灵活性**：任何 Mac（Intel / Apple Silicon）均可构建
2. **无证书要求**：当前使用无签名方式，无需 Apple Developer 证书
3. **构建速度**：本地构建通常比 CI 更快
4. **调试方便**：构建失败时易于排查

### Windows 构建
- **平台**：GitHub Actions（windows-latest）
- **状态**：✅ 已配置，自动构建并上传到阿里云 OSS
- **触发方式**：推送 v* 标签自动触发

---

## macOS 构建环境说明

### 1）任何 Mac 均可构建
**✅ 是**

**任何 Mac（Intel / Apple Silicon）都可以执行构建**：
```bash
npm run build
npx electron-builder --mac --publish never
```

生成的应用可以在本机运行测试，用户安装时需按文档指引处理 Gatekeeper 拦截。

### 2）当前项目使用"无签名构建"

| 条件 | 当前状态 | 说明 |
|------|----------|------|
| Apple Developer 证书 | ❌ 不需要 | 当前使用无签名方式 |
| 公证 | ❌ 不需要 | 跳过公证流程 |
| 环境变量 | ✅ 简单 | 仅需设置 API 地址 |

**检查命令**：
```bash
# 检查 Node.js
node --version

# 检查环境变量
echo $VITE_AUTH_API_BASE_URL
```

### 3）构建方式对比

| 特性 | 当前无签名构建 | 未来签名构建（可选） |
|------|----------------|---------------------|
| 签名 | ❌ 无 | ✅ 有（需证书） |
| 公证 | ❌ 无 | ✅ 有（需配置） |
| Gatekeeper | ⚠️ 需右键打开 | ✅ 正常通过 |
| 构建环境 | 任何 Mac | 任何 Mac |
| 证书成本 | 免费 | $99/年 |
| 适用场景 | 当前项目使用 | 未来可升级 |

---

## 历史构建复现

根据用户反馈，这台 Mac 之前已成功构建过 macOS 版本。复现步骤：

### 构建步骤（任何 Mac 均可执行）
```bash
# 步骤 1：设置 API 地址（必须是 HTTPS 生产地址）
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work

# 步骤 2：执行构建
npm run build
npx electron-builder --mac --publish never

# 步骤 3：检查产物
ls -la release/*/mac*/
```

### 构建成功说明
任何 Mac（Intel / Apple Silicon）构建成功说明：
- ✅ Node.js 环境正常
- ✅ 项目依赖完整
- ✅ electron-builder 配置正确
- ✅ **无需 Apple 开发者证书即可构建**

---

## 生产环境 API 地址固化规范

### 规范目的
**确保正式发布使用生产环境 API 地址，通过 Release Guard 机制防止本地地址误用。**

### ⚠️ 本规范为长期硬规则，不可绕过

以下规则为永久性发布安全规范，**任何发布场景均必须遵守**，不得以任何理由豁免。

### 生产环境 API 地址

| 环境变量 | 生产环境值 | 说明 |
|----------|------------|------|
| `VITE_AUTH_API_BASE_URL` | `https://auth.xiuer.work` | **当前正式生产 API 地址** |
| `AUTH_STORAGE_SECRET` | 32+ 字符高熵随机字符串 | 主进程安全存储密钥；正式发布必须显式注入，不能依赖运行时兜底 |

> **⚠️ 当前硬规则**：生产 API 基线已统一固化为 `https://auth.xiuer.work`。
> 
> **历史记录**:
> - `https://auth.xiuer.work`：当前正式生产 API 地址
> - `http://121.41.179.197:8000`：旧应急基线，仅作为历史记录保留
>
> **发布前必须验证**: API 基线真实可用，域名可解析，服务可访问。

### 强制要求

#### 1. 正式发布必须显式注入环境变量（硬规则）

```bash
# ✅ 正确：显式设置生产环境 HTTPS API 地址
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run release

# ❌ 错误：未设置环境变量
npm run release
# Release Guard 会拦截并阻止发布

# ❌ 错误：设置了错误地址
export VITE_AUTH_API_BASE_URL=https://staging.example.com
# Release Guard 会拦截并阻止发布（地址必须精确为 https://auth.xiuer.work）
```

#### 2. 构建链路环境变量传递路径

```
构建时环境变量传递链：
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  VITE_AUTH_API_BASE_URL (shell env)                         │
│       │                                                      │
│       ├──→ npm run build ──→ Vite 编译时 bake ──→ renderer   │
│       │                                                      │
│       └──→ generate-build-config.js ──→ build-config.json    │
│                                           │                  │
│                                           └──→ main 进程读取  │
│                                                              │
│  AUTH_STORAGE_SECRET (shell env)                             │
│       └──→ generate-build-config.js ──→ build-config.json    │
└──────────────────────────────────────────────────────────────┘

重要：dist:mac / dist:win 脚本本身不注入变量，必须在执行前手动 export。
```

#### 3. Localhost Fallback 机制说明

代码中存在 `import.meta.env.VITE_AUTH_API_BASE_URL || 'localhost'` 的 fallback 模式：

- **开发环境**：fallback 模式允许本地调试更方便
- **发布构建**：当环境变量正确设置时，fallback 不会生效，构建产物使用 `https://auth.xiuer.work`
- **风险控制**：若未设置环境变量，renderer 会 fallback 到 `http://localhost:8000`，**这是发布阻断项**
- **开发/生产区分**：

| 环境 | 允许的 API 地址 | 说明 |
|------|----------------|------|
| 开发环境（`npm run dev`） | `http://localhost:8000` / `http://127.0.0.1:8000` | 仅限本地调试 |
| 生产构建（当前） | `https://auth.xiuer.work` | **当前正式生产 API 地址** |
| 旧应急构建 | `http://121.41.179.197:8000` | 历史应急基线，不得再作为正式发布值 |

#### 4. Release Guard 检查机制

Release Guard (`scripts/release-guard.js`) 在发布前执行以下检查：

| 检查项 | 级别 | 行为 |
|--------|------|------|
| `VITE_AUTH_API_BASE_URL` 未设置 | BLOCKER | 阻止发布 |
| `VITE_AUTH_API_BASE_URL` 值不为 `https://auth.xiuer.work` | BLOCKER | 阻止发布 |
| `VITE_AUTH_API_BASE_URL` 包含 localhost | BLOCKER | 阻止发布 |
| `VITE_AUTH_API_BASE_URL` 包含 127.0.0.1 | BLOCKER | 阻止发布 |
| `AUTH_STORAGE_SECRET` 未设置 | BLOCKER | 阻止发布 |
| `src/shared` 中存在 localhost/127.0.0.1 引用 | BLOCKER | 阻止发布 |

**任何一项 BLOCKER 检查失败，都无法执行发布。**

### 违规处理

| 违规场景 | 处理方式 |
|----------|----------|
| 未设置 VITE_AUTH_API_BASE_URL | Release Guard 拦截，提示设置 `https://auth.xiuer.work` |
| VITE_AUTH_API_BASE_URL 值不正确（非 `https://auth.xiuer.work`） | Release Guard 拦截，提示必须为 `https://auth.xiuer.work` |
| 使用 localhost/127.0.0.1 作为环境变量值 | Release Guard 拦截，提示使用 `https://auth.xiuer.work` |
| 未设置 AUTH_STORAGE_SECRET | Release Guard 与构建脚本拦截，禁止回退到开发态默认密钥 |

---

## v1.5.1 发布经验与教训

### 本次发布关键经验

#### 1. API 基线必须真实可用
- **教训**: 生产 API 基线必须与当前线上正式入口一致，不能继续沿用已经退役的过渡方案
- **措施**: 发布前必须验证 API 基线真实可用，域名可解析，服务可访问
- **当前**: 正式基线已收口为 `https://auth.xiuer.work`

#### 2. 发布门禁必须先通过再发版
- **教训**: release:guard / publish 脚本需要先过门禁再发版
- **措施**: 严格执行 `npm run release:guard`，任何 BLOCKER 都不能跳过
- **当前**: v1.5.1 已通过全部门禁检查

#### 3. 版本号升级规则
- **教训**: 若旧 tag 已推远端且新代码不同，必须升级版本号，不能强改旧 tag
- **措施**: v1.5.0 保留为历史记录，v1.5.1 作为新正式版本
- **当前**: v1.5.0 → v1.5.1 已按 patch 升级

#### 4. 延期项隔离
- **教训**: 延期项必须先隔离，不能带着脏工作区 merge main
- **措施**: 51 个延期文件已隔离到 `feature/v1.5.1-enhancements` 分支
- **当前**: main 分支干净，只包含 v1.5.1 正式功能

#### 5. 质量门禁
- **教训**: TypeScript/lint/test 必须在 main 上最终全部通过后再发布
- **措施**: v1.5.1 发布前 lint ✅ test ✅ tsc ✅ 全部通过
- **当前**: 构建产物已验证可用

---

### v1.5.4 发布经验（Python 安全热修复版）

#### 1. 前端 audit 通过不代表整体 CI 门禁全绿
- **教训**: npm audit 通过（picomatch 已修复）但 pip-audit 失败（cryptography CVE-2026-34073）
- **措施**: 发布前必须同时检查 npm audit 和 pip-audit，两者都通过才算安全门禁全绿
- **当前**: `security-audit` 仍是正式发布前必过项

#### 2. Python 依赖安全检查必须纳入发布前门禁
- **教训**: 之前只关注 npm audit，忽略了 Python 依赖的安全检查
- **措施**: Quality Gate workflow 中的 `security-audit` job 已包含 pip-audit，必须全部通过
- **当前**: Python 安全检查仍是正式发布前必过项

#### 3. patch 版本用于安全热修复，不得重写旧 tag
- **教训**: v1.5.2、v1.5.3、v1.6.0 都出现过“已发版但门禁或构建链路后补修复”的情况
- **措施**: 发现安全门禁或发布链路问题后，使用 patch 热修复版本推进，不重写旧 tag
- **当前**: v1.6.0 → v1.6.1 延续了这条规则

#### 4. 近期版本演进关系
- **v1.5.2**: "安全性与性能优化版" - 4 个核心优化文件，但 npm audit 未通过
- **v1.5.3**: "picomatch 安全修复版" - 修复 npm audit HIGH 漏洞，但 pip-audit 未通过
- **v1.5.4**: "Python 安全热修复版" - 修复 cryptography CVE-2026-34073
- **v1.6.0**: "AI 体验与知识库增强版" - 功能完成，但首次 Windows 构建失败
- **v1.6.1**: "发布链路热修复版" - 修复 npm audit 阻断并恢复 Windows 构建稳定性
- **v1.6.2**: "安全与体验优化版" - 升级 Electron / lodash 依赖并优化 Windows 静默更新链路
- **v1.6.3**: "任务状态一致性与智能运营增强版" - 统一任务真实运行态、补齐自动回复洞察与知识卡辅助能力
- **v1.6.4**: "架构拆分与规则同步版" - 拆分关键模块并补齐共享规则同步校验
- **v1.6.5**: "审计整改与直播控制收口版" - 收紧本地安全策略并优化控制台断连语义
- **v1.6.6**: "知识沉淀与稳定性加固版" - 增强自动回复知识工作台并加固鉴权与运行时清理
- **v1.6.7**: "崩溃恢复与任务自动恢复版" - 加固渲染进程崩溃后的自动重连、任务恢复与断连原因识别

#### 5. 当前正式版本判断标准
- **原则**: 以"最新通过修复后的正式 tag"为准，发布准备阶段必须完成版本 bump、门禁、tag、构建与验证后再对外生效
- **当前准备目标**: v1.6.7 是本次准备进入门禁和发布链路的目标正式版本
- **对外**: 发布完成后统一以 v1.6.7 作为当前正式对外版本

---

### 版本历史记录

| 版本 | API 基线 | 状态 | 说明 |
|------|----------|------|------|
| v1.6.7 | `https://auth.xiuer.work` | 🚧 发布准备中 | 崩溃恢复与任务自动恢复版，加固渲染进程崩溃后的自动重连、任务恢复与断连原因识别 |
| v1.6.6 | `https://auth.xiuer.work` | 📋 历史记录 | 知识沉淀与稳定性加固版，增强自动回复知识工作台并加固鉴权与运行时清理 |
| v1.6.5 | `https://auth.xiuer.work` | 📋 历史记录 | 审计整改与直播控制收口版，收紧本地安全策略并优化控制台断连语义 |
| v1.6.4 | `https://auth.xiuer.work` | 📋 历史记录 | 架构拆分与规则同步版，拆分关键模块并补齐共享规则同步校验 |
| v1.6.3 | `https://auth.xiuer.work` | 📋 历史记录 | 任务状态一致性与智能运营增强版，统一任务真实运行态并补齐回复/弹窗辅助能力 |
| v1.6.2 | `https://auth.xiuer.work` | 📋 历史记录 | 安全与体验优化版，线上正式口径已完成收口 |
| v1.6.1 | `http://121.41.179.197:8000` | 📋 历史记录 | 发布链路热修复版，使用过渡期应急基线 |
| v1.6.0 | `http://121.41.179.197:8000` | 📋 历史记录 | 已发布但首次 Windows 构建失败，沿用过渡期应急基线 |
| v1.5.4 | `http://121.41.179.197:8000` | 📋 历史记录 | Python 安全热修复版，沿用过渡期应急基线 |
| v1.5.3 | `http://121.41.179.197:8000` | 📋 历史记录 | 已发布但 CI Python 安全门禁未全绿，沿用过渡期应急基线 |
| v1.5.2 | `http://121.41.179.197:8000` | 📋 历史记录 | 已发布但 CI npm audit 门禁未全绿，沿用过渡期应急基线 |
| v1.5.1 | `http://121.41.179.197:8000` | 📋 历史记录 | 过渡期应急基线 |
| v1.5.0 | `https://auth.xiuer.work` | 📋 历史记录 | 早期域名基线 |
| v1.4.7 | - | 📋 历史记录 | 上一稳定版本 |
| renderer fallback 到 localhost:8000 | **发布阻断项**，构建产物不可发布，必须重新设置环境变量后重建 |
| electron/main 中存在 localhost fallback | 视为高风险，Release Guard 拦截 |

### 快速验证

发布前验证环境变量配置：

```bash
# 验证环境变量已设置（必须精确为 https://auth.xiuer.work）
echo $VITE_AUTH_API_BASE_URL
# 预期输出: https://auth.xiuer.work

# 验证 AUTH_STORAGE_SECRET
[ -n "$AUTH_STORAGE_SECRET" ] && echo "AUTH_STORAGE_SECRET is set (length: ${#AUTH_STORAGE_SECRET})"

# 执行阻断检查
npm run release:guard
```

> **注意**：仅确认环境变量"已设置"不够，必须确认其值**精确为** `https://auth.xiuer.work`。

---

## 规则：已发布 Tag 不覆盖

### 核心原则
**已发布的 tag 永不覆盖、不删除、不强推。**

### 具体规则
1. **已发布 tag 不覆盖**：一旦 tag 推送到远端，禁止删除后重新创建同名 tag
2. **修复后递增版本号**：如 v1.3.0 发布后发现构建错误或平台兼容问题，修复后发布 v1.3.1
3. **保持历史可追溯**：每个 tag 对应一个不可变的发布版本，便于审计、回滚和复现

### 版本递增规则
| 问题类型 | 版本递增 | 示例 |
|----------|----------|------|
| 构建错误（CI 失败） | 补丁版本 +1 | v1.3.0 → v1.3.1 |
| 平台兼容问题 | 补丁版本 +1 | v1.3.0 → v1.3.1 |
| 紧急 Bug 修复 | 补丁版本 +1 | v1.3.0 → v1.3.1 |
| 新功能发布 | 次版本 +1 | v1.3.0 → v1.4.0 |
| 重大变更 | 主版本 +1 | v1.3.0 → v2.0.0 |

### 执行时间
**从 v1.3.1 开始严格执行此规则。**

> 注：v1.3.0 因首次发布流程中存在 tag 强推操作，作为历史特例记录。后续版本严格遵循此规则。

---

## 规则：先复现，再判断

### ❌ 错误做法
仅凭以下 checklist 直接下结论：
- "没有 Xcode → 不能构建"
- "没有证书 → 不能构建"
- "不是特定机型 → 不能构建"

### ✅ 正确做法
1. **执行构建命令**：任何 Mac（Intel / Apple Silicon）均可尝试构建
2. **观察实际结果**：看是否生成 .app 或 .dmg
3. **明确构建类型**：
   - 能生成 → ✅ 可以构建（当前项目使用无签名方式）
   - 用户安装 → 按文档指引处理 Gatekeeper
4. **明确告知用户**：
   - "任何 Mac 均可构建，当前项目使用无签名方式"
   - "用户安装时需右键打开，详见安装文档"
   - "未来如有需要，可升级至 Apple Developer 签名版本"

---

## 官网主站部署规范

`https://xiuer.work/` 是官方主站，版本标识必须与 `package.json` 当前版本一致。

### 部署命令

```bash
npm run deploy:website
```

`scripts/deploy-website.js` 会在上传前读取 `package.json` 并把首页版本标识渲染为 `v<version> 当前稳定版`，避免 `website/index.html` 中的静态文案滞后。

### 验证命令

```bash
EXPECTED_VERSION=$(node -p "require('./package.json').version")
curl -s https://xiuer.work/ | grep "v${EXPECTED_VERSION} 当前稳定版"
```

---

## 下载页部署规范

### 架构约定

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    download.xiuer.work 目录结构                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  /                           ← 正式下载页（静态网站首页）                 │
│  └── index.html              ← 用户下载入口，面向推广期用户               │
│                                                                         │
│  /releases/latest/           ← 自动更新目录（禁止覆盖）                   │
│  ├── latest.yml              ← Windows 自动更新配置                      │
│  ├── latest-mac.yml          ← macOS 自动更新配置                        │
│  ├── Xiuer-Live-Assistant_*.exe      ← Windows 安装包                    │
│  ├── Xiuer-Live-Assistant_*_arm64.dmg ← macOS Apple 芯片安装包           │
│  └── Xiuer-Live-Assistant_*_x64.dmg   ← macOS Intel 安装包               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 路径独立原则

**重要**：以下两个路径完全独立，禁止互相覆盖

| 路径 | 用途 | 部署方式 |
|------|------|----------|
| `/` (根目录) | 正式下载页 | 手动部署 `index.html` |
| `/releases/latest/` | 自动更新源 | CI 自动上传构建产物 |

### 部署命令

```bash
# 部署下载页到 OSS 根目录
npm run deploy:download-page

# 或直接使用脚本
node scripts/deploy-download-page.js
```

### 发布后必验地址

每次发布后必须验证以下地址可正常访问：

| 地址 | 期望状态 | 说明 |
|------|----------|------|
| `https://xiuer.work/` | HTTP 200 且显示当前 `package.json` 版本 | 官方主站 |
| `https://download.xiuer.work/` | HTTP 200 | 正式下载页 |
| `https://download.xiuer.work/releases/latest/latest.yml` | HTTP 200 | Windows 自动更新配置 |
| `https://download.xiuer.work/releases/latest/latest-mac.yml` | HTTP 200 | macOS 自动更新配置 |
| `https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_*_win-x64.exe` | HTTP 200 | Windows 安装包 |
| `https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_*_macos_arm64.dmg` | HTTP 200 | macOS Apple 芯片安装包 |
| `https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_*_macos_x64.dmg` | HTTP 200 | macOS Intel 安装包 |

### 验证命令

```bash
# 验证官网主站和下载页
curl -I https://xiuer.work/
curl -I https://download.xiuer.work/

# 验证自动更新配置
curl -I https://download.xiuer.work/releases/latest/latest.yml
curl -I https://download.xiuer.work/releases/latest/latest-mac.yml

# 验证安装包（示例版本号，实际根据发布版本调整）
curl -I https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_1.3.3_win-x64.exe
curl -I https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_1.3.3_macos_arm64.dmg
curl -I https://download.xiuer.work/releases/latest/Xiuer-Live-Assistant_1.3.3_macos_x64.dmg
```

---

## 修改记录

| 日期 | 版本 | 修改内容 |
|------|------|---------|
| 2025-03-12 | v2.0 | 建立三层发布结构，明确区分测试构建和正式发布构建 |
| 2025-03-12 | v2.1 | 更新 macOS 构建说明：删除 M3 Ultra 特定表述，明确任何 Mac 均可构建，当前使用无签名方式，未来可升级至 Apple Developer 签名 |
| 2025-03-14 | v2.2 | 添加下载页部署规范：明确 download.xiuer.work/ 为正式下载页，/releases/latest/ 为自动更新目录，两者路径独立；添加发布后必验地址清单 |
| 2026-03-18 | v2.3 | 添加生产环境 API 地址固化规范：明确 VITE_AUTH_API_BASE_URL 必须为 HTTPS 生产地址，强制要求正式发布必须显式注入，禁止 localhost fallback 进入发布包，Release Guard 强制拦截 |
| 2026-03-18 | v2.4 | 明确发布架构与职责边界：本地 Mac 不再依赖 OSS 凭证，OSS 上传统一走 GitHub Actions，npm run upload:mac:oss 保留为手工兜底方案 |
| 2026-03-24 | v2.5 | **硬规则固化**：生产 API 地址固化为 `https://auth.xiuer.work`（精确值，禁止示例占位符）；新增构建链路环境变量传递路径说明；新增 5 个失败处理分支（分支 A-E）；新增 16 项安装包取证验收清单；明确所有失败分支均不可继续后续发布步骤 |
| 2026-05-18 | v2.7 | 补充官网主站部署规范，要求 `xiuer.work` 首页版本与 `package.json` 同步 |

---

## 附录：发布检查清单（简化版）

> **重要**：本清单为简略参考，正式发布请使用上方 [发布前必验清单（安装包验收）](#附录发布前必验清单安装包验收)，确保所有 16 项均已通过。

发布前请逐项确认：

### 环境检查
- [ ] Node.js >= 20.0.0
- [ ] npm >= 10.0.0
- [ ] Git
- [ ] GitHub CLI (`gh`)
- [ ] macOS 11 及以上

### 配置检查
- [ ] `VITE_AUTH_API_BASE_URL` 已设置为 `https://auth.xiuer.work`（**精确值，不得为其他地址**）
- [ ] `AUTH_STORAGE_SECRET` 已设置为 32+ 字符随机字符串
- [ ] Release Guard 检查通过（无 BLOCKER）

### Git 检查
- [ ] Git 工作区干净（无未提交修改）
- [ ] 当前分支为 main
- [ ] Tag 未重复

### 构建检查
- [ ] macOS 安装包已本地测试
- [ ] Windows CI 构建已完成
- [ ] GitHub Release 已创建
- [ ] 所有安装包已上传

### 发布后验证
- [ ] `latest.yml` 可访问
- [ ] `latest-mac.yml` 可访问
- [ ] Windows 安装包可下载
- [ ] macOS 安装包可下载

---

## 附录：发布前必验清单（安装包验收）

> **本清单为发布通过的前置条件**。所有项目必须逐项通过，方可认为发布验收合格。

### 环境与构建检查

| # | 验收项 | 检查命令/方法 | 通过标准 | 状态 |
|---|--------|-------------|---------|------|
| 1 | VITE_AUTH_API_BASE_URL 已设置 | `echo $VITE_AUTH_API_BASE_URL` | 输出为 `https://auth.xiuer.work` | [ ] |
| 2 | AUTH_STORAGE_SECRET 已设置 | `echo $AUTH_STORAGE_SECRET` | 输出长度 ≥ 32 字符 | [ ] |
| 3 | Release Guard 检查通过 | `npm run release:guard` | 无 BLOCKER 输出 | [ ] |
| 4 | dist:mac 命令执行前 env 已 export | 人工确认 | 确认当前 shell 已 export | [ ] |
| 5 | npm run build 成功完成 | `npm run build` | exit code = 0 | [ ] |

### 安装包取证检查（Renderer 进程）

| # | 验收项 | 检查方法 | 通过标准 | 状态 |
|---|--------|---------|---------|------|
| 6 | renderer API_BASE_URL 为生产地址 | 检查 `dist/assets/authApi.*.js` 中包含 `auth.xiuer.work` | 不含 `localhost`、不含 `127.0.0.1` | [ ] |
| 7 | renderer 不含 localhost fallback 产物 | `grep -r "localhost:8000" dist/assets/` | 无匹配 | [ ] |

### 安装包取证检查（Main 进程）

| # | 验收项 | 检查方法 | 通过标准 | 状态 |
|---|--------|---------|---------|------|
| 8 | build-config.json 中 authApiBaseUrl 正确 | `cat dist-electron/build-config.json` | `authApiBaseUrl` 为 `https://auth.xiuer.work` | [ ] |
| 9 | main 进程 fallback 为 localhost | `grep -r "localhost:8000" dist-electron/` | 仅出现在 fallback 默认值上下文，不是实际值 | [ ] |

### 运行时验证

| # | 验收项 | 检查命令/方法 | 通过标准 | 状态 |
|---|--------|-------------|---------|------|
| 10 | /health 访问地址为 auth.xiuer.work | 启动安装包，抓包或看 DevTools Network | 请求发往 `https://auth.xiuer.work/health` | [ ] |
| 11 | 安装包运行日志中无 localhost 连接 | 应用日志 | 不出现 `localhost:8000`、`127.0.0.1:8000` 连接 | [ ] |

### 发布产物完整性

| # | 验收项 | 检查命令/方法 | 通过标准 | 状态 |
|---|--------|-------------|---------|------|
| 12 | GitHub Release 已创建 | `gh release view v<version>` | 存在对应 tag 的 Release | [ ] |
| 13 | Windows 产物已上传 | `gh release view v<version> --json assets` | 包含 `.exe`/`.zip` 文件 | [ ] |
| 14 | macOS 产物已上传 | 同上 | 包含 `.dmg` 文件 | [ ] |
| 15 | CDN latest.yml 可访问 | `curl -I https://download.xiuer.work/releases/latest/latest.yml` | HTTP 200 | [ ] |
| 16 | CDN latest-mac.yml 可访问 | `curl -I https://download.xiuer.work/releases/latest/latest-mac.yml` | HTTP 200 | [ ] |

> **验收通过条件**：所有 16 项全部为 `[ ]` → `[x]`，方可签字发布。

---

## 附录：发布失败处理分支（环境变量相关）

### 失败分支概览

| 失败场景 | 严重程度 | 是否允许继续后续步骤 | 处理章节 |
|----------|----------|---------------------|----------|
| 未设置 VITE_AUTH_API_BASE_URL | 🔴 阻断 | ❌ 不可继续 | [分支 A](#分支-a-未设置-vite_auth_api_base_url) |
| VITE_AUTH_API_BASE_URL 值非 `https://auth.xiuer.work` | 🔴 阻断 | ❌ 不可继续 | [分支 B](#分支-b-vite_auth_api_base_url-值不正确) |
| 未设置 AUTH_STORAGE_SECRET | 🔴 阻断 | ❌ 不可继续 | [分支 C](#分支-c-未设置-auth_storage_secret) |
| 构建后发现 API_BASE_URL 指向 localhost | 🔴 阻断 | ❌ 不可继续 | [分支 D](#分支-d-构建后发现-api_base_url-指向-localhost) |
| /health 未命中 auth.xiuer.work | 🔴 阻断 | ❌ 不可继续 | [分支 E](#分支-e-health-未命中-authxiuerwork) |

---

### 分支 A: 未设置 VITE_AUTH_API_BASE_URL

**现象**：Release Guard 或构建脚本报错 `VITE_AUTH_API_BASE_URL 未设置`

**检查命令**：
```bash
echo $VITE_AUTH_API_BASE_URL
# 无输出或为空
```

**处理原则**：
1. 立即停止构建
2. 显式设置环境变量
3. 重新执行构建命令

**允许继续后续发布步骤**：❌ 否。必须修复后从构建步骤重新开始。

**正确操作**：
```bash
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run release:mac   # 或 npm run build
```

---

### 分支 B: VITE_AUTH_API_BASE_URL 值不正确

**现象**：Release Guard 报错 `VITE_AUTH_API_BASE_URL 不能是本地地址` 或 `地址必须为 https://auth.xiuer.work`

**检查命令**：
```bash
echo $VITE_AUTH_API_BASE_URL
# 输出可能为错误占位符地址、localhost，或旧应急地址 http://121.41.179.197:8000
```

**处理原则**：
1. 立即停止构建
2. 确认生产 API 地址为 `https://auth.xiuer.work`
3. 更新环境变量为正确值
4. 重新执行构建命令

**允许继续后续发布步骤**：❌ 否。必须修复后重新构建。

**正确操作**：
```bash
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
npm run release:mac
```

---

### 分支 C: 未设置 AUTH_STORAGE_SECRET

**现象**：构建脚本报错 `AUTH_STORAGE_SECRET must be set`

**检查命令**：
```bash
echo $AUTH_STORAGE_SECRET
# 无输出或为空
```

**处理原则**：
1. 立即停止构建
2. 生成高熵随机密钥并 export
3. 重新执行构建命令

**允许继续后续发布步骤**：❌ 否。必须修复后重新构建。

**正确操作**：
```bash
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run release:mac
```

---

### 分支 D: 构建后发现 API_BASE_URL 指向 localhost

**现象**：安装包打完后，取证发现 `dist/assets/` 中包含 `localhost:8000` 或 `127.0.0.1:8000`

**检查命令**：
```bash
grep -r "localhost:8000" dist/assets/ | head -5
# 或
grep -r "127.0.0.1:8000" dist/assets/ | head -5
```

**处理原则**：
1. **该安装包立即作废，不得发布**
2. 确认构建时 VITE_AUTH_API_BASE_URL 已正确设置
3. 删除旧的 `dist/` 和 `dist-electron/` 目录
4. 重新执行完整构建流程

**允许继续后续发布步骤**：❌ 否。该安装包已不可用，必须重新构建。

**正确操作**：
```bash
# 1. 确认环境变量
echo $VITE_AUTH_API_BASE_URL  # 必须为 https://auth.xiuer.work

# 2. 清理旧产物
rm -rf dist/ dist-electron/

# 3. 重新构建
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run release:mac
```

**预防措施**：
- 构建前必须确认 `echo $VITE_AUTH_API_BASE_URL` 输出为 `https://auth.xiuer.work`
- 构建后、发布前必须执行取证检查（见"安装包取证检查"章节）

---

### 分支 E: /health 未命中 auth.xiuer.work

**现象**：安装包运行时，网络请求发往了错误的地址（如 `localhost:8000` 或其他 IP）

**检查命令**：
```bash
# 方法 1：启动应用，打开 DevTools → Network → 过滤 /health
# 预期：https://auth.xiuer.work/health

# 方法 2：抓包
sudo tcpdump -i any -n | grep health

# 方法 3：检查应用日志（electron-log）
# 搜索包含 "http://localhost" 或 "127.0.0.1" 的日志
```

**处理原则**：
1. **该安装包立即作废，不得发布**
2. 排查为何 renderer 或 main 进程使用了错误的地址
3. 确认环境变量设置正确后重新构建

**允许继续后续发布步骤**：❌ 否。安装包运行时地址错误，说明构建配置有问题，必须重新构建。

**常见根因**：
- 构建时 VITE_AUTH_API_BASE_URL 未正确 export
- build-config.json 中的地址被覆盖或读取了默认值

**正确操作**：
```bash
# 1. 确认环境变量正确
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)

# 2. 清理并重建
rm -rf dist/ dist-electron/
npm run release:mac

# 3. 重新取证验证
grep -r "auth.xiuer.work" dist/assets/
grep -r "localhost" dist/assets/
```

---

## 附录：常见失败原因

### 1. Git 工作区不干净

**错误信息**：`Git 工作区存在未提交修改`

**解决方案**：
```bash
git add .
git commit -m "chore: prepare release vX.X.X"
```

### 2. 未设置 VITE_AUTH_API_BASE_URL

**错误信息**：`VITE_AUTH_API_BASE_URL 未设置`

**解决方案**：
```bash
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
```

### 3. 未设置 AUTH_STORAGE_SECRET

**错误信息**：`AUTH_STORAGE_SECRET must be set`

**解决方案**：
```bash
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
```

### 4. Localhost 风险

**警告信息**：`发现高风险 localhost/127.0.0.1`

**说明**：
- `src/` 目录中的 localhost 会被视为 BLOCKER（阻止发布）
- `electron/main/` 目录中的 localhost 会被视为 WARNING（需确认）
- `scripts/` 目录中的 localhost 会被视为 INFO（正常）

**解决方案**：确保 `VITE_AUTH_API_BASE_URL` 已设置为 HTTPS 生产地址。

---

**最后更新**：2026-03-24
**规范版本**：v2.5

> **文档关系**：
> - 本规范为发布架构与要求的权威定义
> - 具体操作步骤请查阅 [RELEASE_SOP_MINIMAL.md](./RELEASE_SOP_MINIMAL.md)
> - 发布失败处理请查阅 [RELEASE_TROUBLESHOOTING.md](./RELEASE_TROUBLESHOOTING.md)
> - 本文档已吸收原 [RELEASE_PROCESS.md](./archive/2026-03-release-audit/RELEASE_PROCESS.md) 中的检查清单和故障排除内容
