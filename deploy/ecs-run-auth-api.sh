#!/bin/bash
set -e
# 在 ECS 上从 0 跑起 auth-api（无 Docker），仅操作 /opt/auth-api
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

# 若无代码则从仓库拉取到 /opt/auth-api
if [ ! -f /opt/auth-api/main.py ]; then
  mkdir -p /opt/auth-api
  git clone --depth 1 https://github.com/Xiuer-Chinese/Tasi-live-tool.git /tmp/oba-repo
  cp -r /tmp/oba-repo/auth-api/. /opt/auth-api/
  rm -rf /tmp/oba-repo
fi

cd /opt/auth-api

# Python >= 3.10
python3 --version || { apt-get update && apt-get install -y python3.11 python3.11-venv; }
PY=$(python3 -c "import sys; print('python3' if sys.version_info >= (3,10) else 'python3.11')")
$PY --version

# venv
$PY -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# 数据目录与环境变量
mkdir -p /data
cat > .env << ENVEOF
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
DB_POOL_SIZE=${DB_POOL_SIZE:-10}
DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW:-20}
DB_POOL_TIMEOUT_SECONDS=${DB_POOL_TIMEOUT_SECONDS:-10}
DB_POOL_RECYCLE_SECONDS=${DB_POOL_RECYCLE_SECONDS:-300}
CORS_ORIGINS=${CORS_ORIGINS:-*}
ENVEOF

# 停掉旧进程再起
pkill -f "uvicorn app.main:app" 2>/dev/null || true
sleep 1
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > /opt/auth-api/uvicorn.log 2>&1 &
sleep 2

# 验证
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/docs)
echo "docs HTTP $CODE"
[ "$CODE" = "200" ] && echo "OK" || { echo "FAIL"; tail -50 /opt/auth-api/uvicorn.log; exit 1; }
