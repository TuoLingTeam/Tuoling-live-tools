# 回归验证清单

> **版本**: v1.3
> **最后更新**: 2026-03-28
> **状态**: 已固化
> **负责人**: TEAM
> **当前适用性**: 当前有效
> **关联主文档**: 本文档为回归验证的唯一可信来源
> **当前正式版本**: v1.6.6
> **当前正式 API 基线**: `https://auth.xiuer.work`
> **版本主题**: v1.6.6 是 "知识沉淀与稳定性加固版"

---

> 每次修改代码后，必须验证所有相关项目。标记 `[R]` 表示必须验证，`[O]` 表示可选验证。
> **重要**：打包后回归测试前，必须确认安装包 API 地址已取证验证为 `https://auth.xiuer.work`。
> 
> **历史说明**:
> - 当前正式发布与回归取证统一以 `https://auth.xiuer.work` 为准
> - 旧裸 IP `http://121.41.179.197:8000` 仅作为历史应急口径保留，不得再视为正式方案
>
> 详见 [PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md#_2-2-构建产物取证检查安装包验收)。

---

## 一、登录链路回归

### 1.1 密码登录

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 输入账号密码，点击登录，验证登录成功 | [ ] |
| 开发态 | 登录失败时显示正确错误信息 | [ ] |
| 打包后 | 输入账号密码，点击登录，验证登录成功 | [ ] |
| 打包后 | 登录失败时显示正确错误信息 | [ ] |

### 1.2 验证码登录

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 发送验证码，输入验证码，验证登录成功 | [ ] |
| 开发态 | 验证码过期/错误时显示正确提示 | [ ] |
| 打包后 | 发送验证码，输入验证码，验证登录成功 | [ ] |
| 打包后 | 验证码过期/错误时显示正确提示 | [ ] |

**[已修复/已验收] 手机验证码登录链路 - 2026-03-14**
- 修复内容：验证码登录 → 自动注册 → 设置密码 → 免费试用 完整链路
- 修复文件：
  - `src/components/auth/PhoneAuthDialog.tsx` - 改用主进程代理登录
  - `electron/main/services/cloudAuthClient.ts` - 新增 `cloudSmsLogin`
  - `electron/main/ipc/auth.ts` - 新增 `auth:loginWithSms` handler
  - `electron/preload/auth.ts` - 暴露 `loginWithSms` API
- 验收状态：✅ 已通过真人验收
- 关键修复点：
  - Token 降级逻辑已移除（`apiClient.ts` 不再 fallback 到 renderer 内存 token）
  - 公共认证层已迁移到 `getTokenInternal` 内部可信读取接口
  - `set-password` / `trial-start` 的 401 token_invalid 问题已修复

### 1.3 登录状态持久化

| 验证项 | 状态 |
|--------|------|
| 关闭应用后重新打开，登录状态保持 | [ ] |
| Token 过期后自动刷新 | [ ] |
| 退出登录后状态正确清除 | [ ] |

---

## 二、直播中控台连接回归

### 2.1 连接流程

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 点击"连接直播中控台"，浏览器窗口正常弹出 | [ ] |
| 开发态 | 未登录时显示扫码登录页面 | [ ] |
| 开发态 | 登录成功后状态更新为"已连接" | [ ] |
| 打包后 | 点击"连接直播中控台"，浏览器窗口正常弹出 | [ ] |
| 打包后 | 未登录时显示扫码登录页面 | [ ] |
| 打包后 | 登录成功后状态更新为"已连接" | [ ] |

### 2.2 断开流程

| 验证项 | 状态 |
|--------|------|
| 点击"断开连接"，状态更新为"已断开" | [ ] |
| 断开后浏览器窗口保持打开（不关闭） | [ ] |
| 断开后可以重新连接 | [ ] |

### 2.3 stopAll 行为

| 验证项 | 状态 |
|--------|------|
| stopAll 停止所有任务但不断开中控台 | [ ] |
| stopAll 后 StreamStateDetector 保持活跃 | [ ] |
| stopAll 后可以再次开播 | [ ] |

---

## 三、浏览器窗口回归

### 3.1 窗口显示

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 浏览器窗口可见（非 headless） | [ ] |
| 开发态 | 浏览器窗口大小正常 | [ ] |
| 打包后 | 浏览器窗口可见（非 headless） | [ ] |
| 打包后 | 浏览器窗口大小正常 | [ ] |

### 3.2 浏览器生命周期

| 验证项 | 状态 |
|--------|------|
| 用户关闭浏览器窗口后，状态更新为"已断开" | [ ] |
| 浏览器崩溃后，显示正确错误提示 | [ ] |
| 多账号同时连接，浏览器窗口独立 | [ ] |

---

## 四、跨平台回归

### 4.1 macOS

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 应用正常启动 | [ ] |
| 开发态 | 所有功能正常 | [ ] |
| 打包后 | DMG 安装成功 | [ ] |
| 打包后 | 应用正常启动 | [ ] |
| 打包后 | 所有功能正常 | [ ] |

### 4.2 Windows

| 环境 | 验证项 | 状态 |
|------|--------|------|
| 开发态 | 应用正常启动 | [ ] |
| 开发态 | 所有功能正常 | [ ] |
| 打包后 | 安装包安装成功 | [ ] |
| 打包后 | 应用正常启动（双击有响应） | [ ] |
| 打包后 | 所有功能正常 | [ ] |

---

## 五、性能回归

| 验证项 | 阈值 | 状态 |
|--------|------|------|
| 应用启动时间 | < 3s | [ ] |
| 登录响应时间 | < 2s | [ ] |
| 连接中控台响应时间 | < 5s | [ ] |
| 无明显卡顿 | - | [ ] |
| 内存占用合理 | < 500MB（单账号） | [ ] |

---

## 六、快速验证脚本

> **警告**：以下构建命令中的环境变量为长期硬规则，不得省略或使用其他地址。

```bash
# 开发态快速验证
npm run dev

# 打包后快速验证（macOS）- 必须显式注入环境变量
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run dist:mac

# 打包后快速验证（Windows）- 必须显式注入环境变量
export VITE_AUTH_API_BASE_URL=https://auth.xiuer.work
export AUTH_STORAGE_SECRET=$(openssl rand -hex 32)
npm run dist:win

# 构建后必验：安装包 API 地址取证
grep -r "localhost:8000" dist/assets/ && echo "❌ FAIL: localhost fallback found" || echo "✅ PASS: no localhost fallback"
grep -r "127.0.0.1:8000" dist/assets/ && echo "❌ FAIL: 127.0.0.1 found" || echo "✅ PASS: no 127.0.0.1 fallback"
cat dist-electron/build-config.json | grep authApiBaseUrl
# authApiBaseUrl 必须为 https://auth.xiuer.work
```

---

## 七、回归验证记录模板

```
日期：YYYY-MM-DD
修改内容：[描述修改了什么]
修改文件：[列出修改的文件]

环境变量确认（构建前必填）：
- VITE_AUTH_API_BASE_URL = https://auth.xiuer.work
- AUTH_STORAGE_SECRET = [已设置，长度 N]

安装包取证（打包后必填）：
- [ ] dist/assets/ 无 localhost:8000
- [ ] dist/assets/ 无 127.0.0.1:8000
- [ ] dist-electron/build-config.json authApiBaseUrl = https://auth.xiuer.work
- [ ] /health 运行时发往 https://auth.xiuer.work

验证结果：
- [ ] 开发态密码登录
- [ ] 开发态验证码登录
- [ ] 打包后密码登录
- [ ] 打包后验证码登录
- [ ] 连接直播中控台
- [ ] 浏览器窗口正常弹出
- [ ] 登录后状态正确更新
- [ ] stopAll / disconnect
- [ ] Windows 打包后能启动

问题记录：
[记录发现的问题]
```
