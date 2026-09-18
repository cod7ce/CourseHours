# 课时统计与消费系统

给英语小班教学用的 macOS 桌面应用：排课、点名扣课时、课时账本、充值抵扣、经营报表。
单用户、纯本地，数据只存在这台 Mac 上。产品与技术规格见 [`specs/`](specs/README.md)。

## 技术栈

Tauri 2 · React 19 · TypeScript · Vite · react-router 7 · Rust（rusqlite）

- 业务规则（扣课时、FIFO 选包、充值抵扣、排课展开）是 Rust 纯函数，带单测
- 点名 / 充值 / 撤销都是 SQLite 事务，账本 `ledger_entry` 只追加不修改
- 前端不引 UI 库、不引图表库，样式变量来自 `specs/design/design-tokens.md`

## 开发

```bash
pnpm install
source ~/.cargo/env               # 需要 Rust 工具链（rustup）
pnpm tauri dev                    # 启动开发版
COURSEHOURS_SEED=1 pnpm tauri dev # 空库时写入一套演示数据（仅 debug 构建有效）
```

测试与检查：

```bash
pnpm typecheck                    # 前端类型检查
cd src-tauri && cargo test        # 48 个 Rust 单测 + 集成测试
```

## 打包

```bash
pnpm tauri build
```

产物在 `src-tauri/target/release/bundle/`（`macos/课时统计.app` 与 `dmg/`）。未签名、未公证。

## 版本与更新

安装：到 [Releases](https://github.com/cod7ce/CourseHours/releases/latest) 下载 `CourseHours-<版本>-mac-arm64.dmg`，拖进「应用程序」。因为没有 Apple 公证，第一次打开会提示「已损坏」，在终端跑一次即可：

```bash
xattr -dr com.apple.quarantine "/Applications/课时统计.app"
```

之后应用内自动更新的版本不需要再跑（替换脚本会顺手清掉隔离属性）。

应用启动 20 秒后和之后每 6 小时静默检查一次 GitHub Releases，发现新版本时侧边栏「设置」旁出现红点；「设置 → 版本」里可以手动检查、查看更新说明、一键「下载并安装」：下载 zip → 解压 → 退出后原地替换 .app → 自动重启。实现在 `src-tauri/src/commands/updater.rs`，没有用 `tauri-plugin-updater`（它要求给更新包签名）。替换脚本先把旧版改名备份，复制成功才删，失败回滚。

发新版本：

```bash
scripts/bump.sh 0.1.1     # 同步 package.json / tauri.conf.json / Cargo.toml，提交并打 tag v0.1.1
scripts/release.sh        # 本地打包，产出 dmg + zip，创建 GitHub Release 并上传
```

也可以只 `git push origin v0.1.1`，`.github/workflows/release.yml` 会在 GitHub Actions 上构建并上传。`.zip` 给自动更新用，`.dmg` 给人下载。

## 隐藏金额

侧边栏「显示金额 / 隐藏金额」：默认隐藏，所有金额显示为 `¥•••`；点「显示金额」先过系统验证（Touch ID，没有则登录密码），当天有效，隔天自动回到隐藏。验证走 `src-tauri/authlock/main.swift`（LocalAuthentication），由 `scripts/build-authlock.sh` 编译成 sidecar 随应用打包，`pnpm tauri dev / build` 前会自动编译。

## 数据

- 数据库：`~/Library/Application Support/com.coursehours.app/data.db`
- 备份：同目录 `backups/`，每晚按设置自动 `VACUUM INTO`，也可在「设置 → 数据与备份」手动备份 / 恢复 / 导出
- 设置页有「校验账本一致性」按钮，逐条检查 `specs/01-domain-model.md` 里的不变量
