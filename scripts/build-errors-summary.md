# npm run build 错误汇总表（第一轮修复前）

> 本表根据用户截图与 18 个报错文件整理。完整列表请在本机执行 `npm run build 2>&1 | Tee-Object -FilePath tmp/build-output.txt` 后查看 `tmp/build-output.txt`。

## 错误汇总（按优先级）

### P0：阻断编译的结构性错误

| 文件路径 | 行:列 | TS 错误码 | 第一行错误信息 |
|----------|-------|-----------|----------------|
| src/tasks/gateCheck.ts | 6:35 | TS2306 | File '.../shared/types.d.ts' is not a module. |
| src/tasks/TaskManager.ts | 79:56 | TS1361 | 'BaseTask' cannot be used as a value because it was imported using 'import type'. |

### P1：API 类型缺失（removeListener）

| 文件路径 | 行:列 | TS 错误码 | 第一行错误信息 |
|----------|-------|-----------|----------------|
| src/tasks/autoSpeakTask.ts | 49:32 | TS2339 | Property 'removeListener' does not exist on type '{ invoke: ...; send: ...; on: ... }'. |
| src/tasks/autoPopupTask.ts | 49:32 | TS2339 | 同上 |
| src/tasks/autoReplyTask.ts | 52:32 | TS2339 | 同上 |

### P2/P3：返回值类型不匹配

| 文件路径 | 行:列 | TS 错误码 | 第一行错误信息 |
|----------|-------|-----------|----------------|
| src/tasks/TaskManager.ts | 169:44 | TS2345 | Argument of type '"error" \| "disconnected" \| ...' is not assignable to parameter of type 'TaskStopReason'. |

### 其余 18 个文件（42 个错误）

- electron/main/platforms/xiaohongshu/index.ts:76
- electron/main/services/AuthDatabase.ts:228 (2)
- electron/main/services/StreamStateDetector.ts:7 (4)
- src/App.tsx:19 (2)
- src/components/auth/AuthGuard.tsx:124
- src/components/common/Sidebar.tsx:72
- src/hooks/useAutoReply.ts:359
- src/hooks/useLiveControl.ts:2
- src/hooks/useLiveFeatureGate.ts:7
- src/hooks/useTaskManager.ts:41 (3)
- src/pages/LiveControl/components/StatusCard.tsx:148 (3)
- src/services/MockAuthService.ts:200 (3)
- src/stores/authStore.ts:37 (11)
- src/tasks/autoPopupTask.ts:49
- src/tasks/autoReplyTask.ts:19 (3)
- src/tasks/autoSpeakTask.ts:49
- src/tasks/gateCheck.ts:6
- src/tasks/TaskManager.ts:79, 169

## 第一轮修复计划（已执行）

1. **P0**：gateCheck 从 `shared/types` 改为 `shared/streamStatus`（新建 `shared/streamStatus.ts` 导出 `StreamStatus`）。
2. **P0**：TaskManager 将 `BaseTask` 改为普通 `import`，其余类型保持 `import type`。
3. **P1**：autoSpeakTask / autoPopupTask / autoReplyTask 用 `on()` 返回的 unsubscribe 替代 `removeListener`。
4. **P2/P3**：taskGate 中 `TaskStopReason` 增加 `gate_failed`、`error`，并补全 `reasonMap`。

## 验证命令

```powershell
cd "D:\Windsurf-test\oba-live-tool-main\CURSOR\oba-live-tool-main"
npm run build 2>&1 | Tee-Object -FilePath tmp/build-output.txt
# 查看最后 50 行
Get-Content tmp/build-output.txt -Tail 50
```
