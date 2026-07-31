#!/usr/bin/env bash
# 本地测试 → 提交 → 推送到 GitHub → Vercel 自动部署
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "用法: ./scripts/publish.sh \"提交说明\""
  echo "示例: ./scripts/publish.sh \"feat: 添加会议室管理\""
  exit 1
fi

MSG="$1"
BRANCH="${2:-main}"

echo "▶ 运行测试..."
npm test

echo "▶ 暂存变更..."
git add -A

if git diff --staged --quiet; then
  echo "没有需要提交的变更。"
  exit 0
fi

echo "▶ 提交: $MSG"
git commit -m "$MSG"

echo "▶ 推送到 GitHub ($BRANCH)..."
git push origin "$BRANCH"

echo ""
echo "✓ 已推送到 GitHub"
echo "  Vercel 将自动从 main 分支部署（约 1–2 分钟）"
echo "  查看: https://vercel.com/dashboard → meeting-assistant → Deployments"
echo "  访问: https://meeting-assistant-topaz.vercel.app"
