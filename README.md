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

产物在 `src-tauri/target/release/bundle/`（`macos/课时统计.app` 与 `dmg/`）。未签名，首次打开需在访达里右键 → 打开。

## 数据

- 数据库：`~/Library/Application Support/com.coursehours.app/data.db`
- 备份：同目录 `backups/`，每晚按设置自动 `VACUUM INTO`，也可在「设置 → 数据与备份」手动备份 / 恢复 / 导出
- 设置页有「校验账本一致性」按钮，逐条检查 `specs/01-domain-model.md` 里的不变量
