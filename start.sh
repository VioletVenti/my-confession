#!/usr/bin/env bash
# My Confession —— Linux / macOS 启动脚本
# 用法：  ./start.sh            默认 8080
#         PORT=9000 ./start.sh  换端口
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[X] 没找到 node。请安装 Node.js 22.5 或更高版本：https://nodejs.org/" >&2
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 5 ]; }; then
  echo "[X] 当前 Node $(node -v) 太旧：node:sqlite 需要 22.5 以上" >&2
  exit 1
fi

if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "[X] 这个 Node 没有 node:sqlite 模块，请升级到 22.5+（推荐 24 LTS）" >&2
  exit 1
fi

export PORT="${PORT:-8080}"
mkdir -p data

echo "[OK] Node $(node -v)   PORT=$PORT"
exec node server.js
