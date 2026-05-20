#!/bin/bash
set -e

# ⚠️ 重要：生产环境必须设置以下环境变量：
#   - DATABASE_URL
#   - JWT_SECRET
#   - CORS_ORIGINS (可选，默认 *)

# 检查必需的环境变量
if [ -z "$DATABASE_URL" ]; then
    echo "错误：未设置 DATABASE_URL 环境变量"
    exit 1
fi

if [ -z "$JWT_SECRET" ]; then
    echo "错误：未设置 JWT_SECRET 环境变量"
    exit 1
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    echo "错误：JWT_SECRET 长度不足，至少需要 32 个字符"
    exit 1
fi

# 1. 检查并安装 python3 / python3-venv / pip
apt-get update -qq
apt-get install -y python3 python3-venv python3-pip

if ! python3 - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
then
    echo "错误：auth-api 需要 Python 3.10 或更高版本"
    exit 1
fi

# 2. 在 /opt/auth-api 创建 venv
cd /opt/auth-api
python3 -m venv .venv

# 3. 激活 venv
# shellcheck source=/dev/null
source .venv/bin/activate

# 4. pip install -r requirements.txt
pip install -q -r requirements.txt

# 5. 创建 .env（从环境变量读取）
mkdir -p /data
cat > .env << EOF
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGINS=${CORS_ORIGINS:-*}
EOF

# 6. nohup 启动 uvicorn
pkill -f "uvicorn app.main:app" 2>/dev/null || true
sleep 1
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 >> /opt/auth-api/uvicorn.log 2>&1 &
sleep 2

# 7. 输出校验命令
echo "--- 校验：监听端口 ---"
ss -tlnp | grep 8000
echo "--- 校验：/docs ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/docs
echo "--- 校验：/auth/register ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://127.0.0.1:8000/auth/register -H "Content-Type: application/json" -d '{"identifier":"t@t.com","password":"123456"}'
echo "--- 校验：/auth/login ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://127.0.0.1:8000/auth/login -H "Content-Type: application/json" -d '{"identifier":"t@t.com","password":"123456"}'
