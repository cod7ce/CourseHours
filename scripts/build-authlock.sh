#!/usr/bin/env bash
# 编译 Touch ID 助手为 Tauri sidecar：src-tauri/bin/authlock-<target-triple>
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
TRIPLE=$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')
[ -z "$TRIPLE" ] && { ARCH=$(uname -m); [ "$ARCH" = "arm64" ] && TRIPLE=aarch64-apple-darwin || TRIPLE=x86_64-apple-darwin; }
mkdir -p bin
OUT="bin/authlock-$TRIPLE"
if [ ! -f "$OUT" ] || [ authlock/main.swift -nt "$OUT" ]; then
  swiftc -O -framework LocalAuthentication -o "$OUT" authlock/main.swift
  echo "built $OUT"
else
  echo "up to date: $OUT"
fi
