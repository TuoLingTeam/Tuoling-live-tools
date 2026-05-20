#!/usr/bin/env bash
# 结构性问题直接失败；本机缺少 compose / nginx 等工具时仅告警，避免误伤开发机自检。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy"
NGINX_CONF="$DEPLOY_DIR/nginx/auth-api-ha.conf"
HA_COMPOSE="$DEPLOY_DIR/docker-compose.ha.yml"
HA_RDS_COMPOSE="$DEPLOY_DIR/docker-compose.ha.rds.yml"

WARNINGS=()

pass() {
  printf 'PASS  %s\n' "$1"
}

warn() {
  WARNINGS+=("$1")
  printf 'WARN  %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1" >&2
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "缺少文件: $file"
  pass "文件存在: $file"
}

require_pattern() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if grep -Fq "$pattern" "$file"; then
    pass "$message"
  else
    fail "$message"
  fi
}

compose_tool() {
  if docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    printf 'docker-compose'
    return 0
  fi

  return 1
}

run_compose_config_check() {
  local compose_file="$1"
  local compose_cmd
  compose_cmd="$(compose_tool)" || {
    warn "未检测到 docker compose / docker-compose，跳过 $compose_file 语法校验"
    return 0
  }

  local cmd=()
  if [[ "$compose_cmd" == "docker compose" ]]; then
    cmd=(docker compose)
  else
    cmd=(docker-compose)
  fi

  (
    export DATABASE_URL='mysql+pymysql://root:placeholder@mysql:3306/auth_db'
    export JWT_SECRET='placeholder-secret-0123456789'
    export ADMIN_PASSWORD='placeholder-admin-password'
    export ADMIN_USERNAME='admin'
    export MYSQL_ROOT_PASSWORD='placeholder-root-password'
    export CORS_ORIGINS='*'
    export AUTH_API_BASE_IMAGE='python:3.11-slim'
    export SMS_MODE='aliyun_dypns'
    "${cmd[@]}" -f "$compose_file" config >/dev/null
  ) || fail "Compose 配置校验失败: $compose_file"

  pass "Compose 配置校验通过: $compose_file"
}

run_nginx_syntax_check() {
  if ! command -v nginx >/dev/null 2>&1; then
    warn '未检测到 nginx，跳过 auth-api-ha.conf 语法校验'
    return 0
  fi

  local temp_conf
  temp_conf="$(mktemp)"
  trap 'rm -f "$temp_conf"' EXIT

  cat >"$temp_conf" <<EOF
events {}
http {
    include $NGINX_CONF;
}
EOF

  nginx -t -c "$temp_conf" -p "$ROOT_DIR" >/dev/null 2>&1 || fail "Nginx 配置语法校验失败: $NGINX_CONF"
  pass "Nginx 配置语法校验通过: $NGINX_CONF"
}

printf '== Auth API HA 部署自检 ==\n'

require_file "$HA_COMPOSE"
require_file "$HA_RDS_COMPOSE"
require_file "$NGINX_CONF"

require_pattern "$HA_COMPOSE" 'api-a:' 'HA compose 包含 api-a'
require_pattern "$HA_COMPOSE" 'api-b:' 'HA compose 包含 api-b'
require_pattern "$HA_COMPOSE" 'gateway:' 'HA compose 包含 gateway'
require_pattern "$HA_COMPOSE" 'condition: service_healthy' 'HA compose 使用健康检查依赖'
require_pattern "$HA_COMPOSE" './nginx/auth-api-ha.conf:/etc/nginx/conf.d/default.conf:ro' 'HA compose 正确挂载 Nginx 配置'

require_pattern "$HA_RDS_COMPOSE" 'api-a:' 'HA RDS compose 包含 api-a'
require_pattern "$HA_RDS_COMPOSE" 'api-b:' 'HA RDS compose 包含 api-b'
require_pattern "$HA_RDS_COMPOSE" 'gateway:' 'HA RDS compose 包含 gateway'

require_pattern "$NGINX_CONF" 'upstream auth_api_backend' 'Nginx 配置包含 upstream'
require_pattern "$NGINX_CONF" 'server api-a:8000' 'Nginx upstream 包含 api-a'
require_pattern "$NGINX_CONF" 'server api-b:8000' 'Nginx upstream 包含 api-b'
require_pattern "$NGINX_CONF" 'location /health' 'Nginx 配置包含 /health'
require_pattern "$NGINX_CONF" 'location /messages/stream' 'Nginx 配置包含 /messages/stream'
require_pattern "$NGINX_CONF" 'proxy_buffering off;' 'SSE 已关闭代理缓冲'
require_pattern "$NGINX_CONF" 'proxy_request_buffering off;' 'SSE 已关闭请求缓冲'
require_pattern "$NGINX_CONF" 'proxy_set_header Accept-Encoding "";' 'SSE 已禁用上游压缩'
require_pattern "$NGINX_CONF" 'add_header X-Accel-Buffering no always;' 'SSE 明确禁止 Nginx 加速缓冲'
require_pattern "$NGINX_CONF" 'add_header Cache-Control no-cache always;' 'SSE 返回 no-cache 响应头'
require_pattern "$NGINX_CONF" 'proxy_next_upstream error timeout http_502 http_503 http_504;' 'Nginx 已开启失败切换'
require_pattern "$NGINX_CONF" 'max_fails=1 fail_timeout=3s;' 'Nginx upstream 可快速摘除异常实例'
require_pattern "$NGINX_CONF" 'proxy_connect_timeout 1s;' 'Nginx 上游连接超时已收紧'
require_pattern "$NGINX_CONF" 'proxy_next_upstream_timeout 3s;' 'Nginx 失败切换总时长已限制'

require_pattern "$HA_COMPOSE" 'stop_grace_period: 15s' 'HA compose 为 API 配置优雅停止窗口'
require_pattern "$HA_COMPOSE" 'interval: 5s' 'HA compose 已缩短健康检查间隔'
require_pattern "$HA_RDS_COMPOSE" 'stop_grace_period: 15s' 'HA RDS compose 为 API 配置优雅停止窗口'
require_pattern "$HA_RDS_COMPOSE" 'interval: 5s' 'HA RDS compose 已缩短健康检查间隔'

run_compose_config_check "$HA_COMPOSE"
run_compose_config_check "$HA_RDS_COMPOSE"
run_nginx_syntax_check

if [[ "${#WARNINGS[@]}" -gt 0 ]]; then
  printf '\n-- Warnings --\n'
  for item in "${WARNINGS[@]}"; do
    printf '%s\n' "$item"
  done
fi

printf '\nHA 部署自检完成\n'
