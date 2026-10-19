#!/usr/bin/env bash
# Serve the existing build only; never install dependencies or rebuild implicitly.
set -euo pipefail
PORT=4173
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
URL="http://127.0.0.1:$PORT/"
fail() { printf 'jiagoutu：%s\n' "$*" >&2; exit 1; }

[[ -f "$ROOT/dist/index.html" ]] || fail "缺少 dist 构建。请在项目目录完成 npm run build，再打开快捷方式；启动器不会自行构建。"
for tool in curl ss flock setsid; do
  command -v "$tool" >/dev/null || fail "缺少本机工具 $tool；请修复本地环境后重试。"
done
umask 077
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}/jiagoutu-$UID-$PORT"
mkdir -p -- "$RUNTIME"
[[ -O "$RUNTIME" && ! -L "$RUNTIME" ]] || fail "启动日志目录身份异常：$RUNTIME"
exec 9>"$RUNTIME/launch.lock"
flock -w 25 9 || fail "另一个启动仍未完成，请稍后重试。"

owns_port() {
  local listeners pid cwd args
  listeners=$(ss -H -ltnp "sport = :$PORT")
  [[ -n "$listeners" ]] || return 1
  pid=$(sed -n 's/.*pid=\([0-9]*\).*/\1/p' <<<"$listeners" | sort -u)
  [[ "$pid" =~ ^[0-9]+$ ]] || fail "端口 $PORT 已被占用，但无法确认服务身份；不会停止或替换它。"
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  args=$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)
  [[ "$cwd" -ef "$ROOT" && "$args" == *vite* && "$args" == *" preview "* && "$args" == *"--port $PORT"* ]] ||
    fail "端口 $PORT 被其他服务占用（PID $pid）；不会停止它。请先解决端口冲突。"
}
healthy() {
  curl -fsS --connect-timeout 1 --max-time 2 "$URL" 2>/dev/null | cmp -s "$ROOT/dist/index.html" -
}

if owns_port; then
  healthy || fail "本项目服务已存在，但页面尚未就绪或与 dist 不符。请检查现有服务；启动器不会重启它。"
else
  command -v npm >/dev/null || fail "找不到 npm；请修复 WSL 登录环境后重试。"
  [[ -f "$ROOT/node_modules/vite/bin/vite.js" ]] || fail "项目依赖缺失。请修复依赖后重试；启动器不会下载或安装。"
  cd -- "$ROOT"
  setsid nohup npm run start >>"$RUNTIME/server.log" 2>&1 </dev/null 9>&- &
  for ((attempt=0; attempt<75; attempt++)); do
    if owns_port && healthy; then
      printf '%s\n' "$URL"
      exit 0
    fi
    sleep 0.2
  done
  fail "本地页面启动未就绪。请查看 $RUNTIME/server.log；不会打开错误页面。"
fi
printf '%s\n' "$URL"
