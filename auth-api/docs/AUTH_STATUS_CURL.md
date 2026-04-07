# GET /auth/status 验证（含 plan、trial，trial 来自 trials 表）

## 修改说明

- `GET /auth/status` 现从 **trials** 表（与 POST /auth/trial/start、GET /auth/trial/status 一致）读取试用数据。
- 返回 JSON 满足前端 `UserStatus`：`username`、`status`、`plan`、`created_at`、`last_login_at`、`trial`（含 `start_at`、`end_at`、`is_active`、`is_expired`）。
- 若有试用且未过期，`plan` 为 `"trial"`；无试用或已过期时 `trial` 为 `{ "is_active": false, "is_expired": false }`。

## curl 验证

**1. 登录拿 token**

```bash
curl -s -X POST "https://auth.xiuer.work/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"你的邮箱或手机号","password":"你的密码"}'
```

从响应中取 `access_token` 或 `token`，记为 `TOKEN`。

**2. 调用 GET /auth/status（无试用时）**

```bash
curl -s -X GET "https://auth.xiuer.work/auth/status" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

预期示例（默认用户）：含 `username`、`status`、`plan`（如 `"trial"`）、`created_at`、`last_login_at`、`trial`（`is_active: false`、`is_expired: false`）。

**3. 开通试用后再查 GET /auth/status**

```bash
# 开通试用（TOKEN 同上）
curl -s -X POST "https://auth.xiuer.work/auth/trial/start" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"当前登录用户名"}'

# 再查状态
curl -s -X GET "https://auth.xiuer.work/auth/status" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

预期示例（试用中）：`plan` 为 `"trial"`，`trial` 含 `start_at`、`end_at`（ISO 字符串）、`is_active: true`、`is_expired: false`。
