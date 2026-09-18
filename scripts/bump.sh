#!/usr/bin/env bash
# 用法: scripts/bump.sh 0.1.1   —— 同步三处版本号，提交并打 tag v0.1.1
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:?用法: scripts/bump.sh <x.y.z>}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "版本号格式不对：$V"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "工作区有未提交的改动，先提交或暂存"; exit 1; }

sed -i '' "s/^  \"version\": \".*\",$/  \"version\": \"$V\",/" package.json
sed -i '' "s/^  \"version\": \".*\",$/  \"version\": \"$V\",/" src-tauri/tauri.conf.json
sed -i '' "s/^version = \".*\"$/version = \"$V\"/" src-tauri/Cargo.toml
(cd src-tauri && source ~/.cargo/env 2>/dev/null; cargo update -p coursehours --offline >/dev/null 2>&1 || cargo generate-lockfile >/dev/null 2>&1 || true)

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "v$V"
git tag -a "v$V" -m "v$V"
echo "✅ 已提交并打 tag v${V}。发布：scripts/release.sh"
