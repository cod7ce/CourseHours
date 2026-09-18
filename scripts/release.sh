#!/usr/bin/env bash
# 本地发布：按当前版本打包，产出 CourseHours-<v>-mac-<arch>.{dmg,zip}，创建 GitHub Release 并上传。
# 前提：已用 scripts/bump.sh 打好 tag，gh 已登录。
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.cargo/env 2>/dev/null || true

REPO="cod7ce/CourseHours"
V=$(node -p "require('./package.json').version")
TAG="v$V"
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && A="arm64" || A="x64"
NAME="CourseHours-$V-mac-$A"
OUT="src-tauri/target/release/bundle"

git rev-parse "$TAG" >/dev/null 2>&1 || { echo "❌ 本地没有 tag $TAG，先跑 scripts/bump.sh $V"; exit 1; }
echo "▸ 推送 main 与 tag $TAG"
git push -q origin main "$TAG" 2>&1 | tail -1 || true

echo "▸ 打包 $TAG"
pnpm tauri build >/dev/null
APP=$(ls -d "$OUT"/macos/*.app | head -1)
DMG=$(ls "$OUT"/dmg/*.dmg | head -1)
DIST="release"; rm -rf "$DIST"; mkdir -p "$DIST"
cp "$DMG" "$DIST/$NAME.dmg"
# zip 给自动更新用：ditto 保留 bundle 结构与权限
/usr/bin/ditto -c -k --keepParent "$APP" "$DIST/$NAME.zip"
ls -la "$DIST"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "▸ Release $TAG 已存在，上传产物（覆盖同名）"
  gh release upload "$TAG" "$DIST/$NAME.dmg" "$DIST/$NAME.zip" --repo "$REPO" --clobber
else
  echo "▸ 创建 Release $TAG"
  gh release create "$TAG" "$DIST/$NAME.dmg" "$DIST/$NAME.zip" --repo "$REPO" --verify-tag --title "$TAG" --generate-notes
fi
echo "✅ 发布完成：https://github.com/$REPO/releases/tag/$TAG"
