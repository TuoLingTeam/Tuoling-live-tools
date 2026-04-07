# 管理员 API 交付说明

## 一、修改文件列表

| 文件 | 说明 |
|------|------|
| `auth-api/config.py` | 新增 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_JWT_SECRET` 配置及环境变量覆盖 |
| `auth-api/database.py` | migration：为 users 表补列 `created_at`、`status`（不存在时 ALTER TABLE） |
| `auth-api/deps.py` | 管理员 JWT（create_admin_token/decode_admin_token/get_current_admin）、审计日志 auth_audit_log |
| `auth-api/main.py` | 挂载 admin 路由、RequestIdMiddleware |
| `auth-api/routers/admin.py` | **新增**：/admin/login、/admin/users、/admin/users/{username}、disable、enable、reset-password、delete |
| `auth-api/schemas_admin.py` | **新增**：AdminLoginBody/Response、AdminUserListItem/Detail、AdminResetPasswordBody/Response |
| `auth-api/export_openapi.py` | **新增**：导出 openapi.json |
| `auth-api/scripts/test_admin_curl.sh` | **新增**：curl 自测脚本 |
| `auth-api/scripts/test_admin_api.py` | **新增**：Python 自测脚本 |
| `auth-api/openapi.json` | 导出结果（含 /admin 路径，供 Appsmith/Budibase 使用） |

---

## 二、各接口请求示例

### 1. 管理员登录（无需 token）

```http
POST /admin/login
Content-Type: application/json

{"username": "admin", "password": "你的管理员密码"}
```

响应示例：

```json
{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}
```

### 2. 用户列表（需 Admin Bearer Token）

```http
GET /admin/users?query=&page=1&size=20
Authorization: Bearer <上一步获得的 token>
```

响应示例：

```json
{
  "items": [
    {
      "username": "user@example.com",
      "user_id": "uuid",
      "created_at": "2025-02-03T10:00:00",
      "disabled": false,
      "trial_end": 1738587600,
      "plan": "trial",
      "membership_status": "trial",
      "membership_label": "试用中",
      "membership_expire_at": null,
      "membership_type": "none"
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20
}
```

### 3. 用户详情

```http
GET /admin/users/user@example.com
Authorization: Bearer <admin_token>
```

（路径中的 `username` 为用户的邮箱或手机号，需 URL 编码，如 `user%40example.com`）

### 4. 禁用用户

```http
POST /admin/users/user@example.com/disable
Authorization: Bearer <admin_token>
```

### 5. 启用用户

```http
POST /admin/users/user@example.com/enable
Authorization: Bearer <admin_token>
```

### 6. 重置密码

- 传新密码（可选）：

```http
POST /admin/users/user@example.com/reset-password
Authorization: Bearer <admin_token>
Content-Type: application/json

{"new_password": "NewSecurePass123"}
```

- 不传则生成临时密码并返回：

```http
POST /admin/users/user@example.com/reset-password
Authorization: Bearer <admin_token>
```

响应示例（不传时）：`{"ok": true, "temp_password": "xxx", "message": "已生成临时密码，请妥善保管"}`

### 7. 删除用户

```http
DELETE /admin/users/user@example.com
Authorization: Bearer <admin_token>
```

---

## 三、服务器 .env 变量清单与示例

在服务器上为 auth-api 增加或确认以下变量（示例值不含真实密码）：

```env
# 管理员账号（必填）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码

# 可选：管理员 JWT 独立密钥，不填则复用 JWT_SECRET
ADMIN_JWT_SECRET=

# 现有变量保持（DB 仍用 sqlite 时示例）
DATABASE_URL=sqlite:////data/users.db
JWT_SECRET=你的业务 JWT 密钥
```

| 变量 | 必填 | 说明 | 示例值 |
|------|------|------|--------|
| `ADMIN_USERNAME` | 是 | 管理员登录用户名 | `admin` |
| `ADMIN_PASSWORD` | 是 | 管理员登录密码 | （强密码，勿提交仓库） |
| `ADMIN_JWT_SECRET` | 否 | 管理员 JWT 签名密钥，空则用 `JWT_SECRET` | 留空或单独密钥 |
| `DATABASE_URL` | 是 | 数据库连接 | `sqlite:////data/users.db` |
| `JWT_SECRET` | 是 | 业务 JWT 密钥 | （生产环境强随机串） |

---

## 四、重启 Docker Compose

当前仓库 `deploy/docker-compose.yml` 中服务名为 `api`，部署目录下执行：

```bash
cd deploy
docker compose restart api
```

若使用 docker-compose.ecs.yml 或服务名为 auth-api：

```bash
docker compose -f docker-compose.ecs.yml restart api
```

若需重建镜像后再起：

```bash
docker compose up -d --build api
```

**注意**：若生产使用 SQLite（`DATABASE_URL=sqlite:////data/users.db`），需在 api 服务中挂载 `/data` 卷并增加环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD`（及可选 `ADMIN_JWT_SECRET`）。

---

## 五、自测方式

- **curl 集合**（需先设置环境变量）：

```bash
export BASE_URL=https://auth.xiuer.work
export ADMIN_USER=admin
export ADMIN_PASS=你的管理员密码
bash auth-api/scripts/test_admin_curl.sh
```

- **Python 自测**：

```bash
cd auth-api
AUTH_BASE_URL=https://auth.xiuer.work ADMIN_USER=admin ADMIN_PASS=你的管理员密码 python scripts/test_admin_api.py
```

---

## 六、OpenAPI 中 /admin 路径（供验收）

在 `auth-api/openapi.json` 中可看到以下路径：

- `POST /admin/login` — Admin Login
- `GET /admin/users` — Admin List Users（query, page, size）
- `GET /admin/users/{username}` — Admin Get User
- `DELETE /admin/users/{username}` — Admin Delete User
- `POST /admin/users/{username}/disable` — Admin Disable User
- `POST /admin/users/{username}/enable` — Admin Enable User
- `POST /admin/users/{username}/reset-password` — Admin Reset Password（body 可选 AdminResetPasswordBody）

重新导出 openapi.json：

```bash
cd auth-api
DATABASE_URL=sqlite:///./tmp.db python export_openapi.py
```

---

## 七、审计日志

所有管理员关键操作会写入日志，格式：

`[AUTH-AUDIT] requestId=... url=... action=... targetUser=... status=... response=...`

其中 `response` 已脱敏（password、token、secret 等字段为 `***`）。
