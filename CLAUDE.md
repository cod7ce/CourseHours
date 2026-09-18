# CourseHours · 课时统计与消费系统

macOS 桌面应用，单用户、纯本地。规格全在 `specs/`（先读 `specs/README.md`）。

## 技术栈
- Tauri 2 + React 19 + TypeScript + Vite 8 + react-router 7（hash 路由）
- 后端 Rust：rusqlite（bundled）、chrono、uuid。数据库 `~/Library/Application Support/com.coursehours.app/data.db`
- 没有 ORM、没有 UI 组件库、没有图表库（按 spec 要求）

## 目录
```
src-tauri/src/
  core/        ★ 纯函数业务规则（扣课时 / FIFO 选包 / 充值抵扣 / 排课展开）+ 单测
  commands/    Tauri 命令，按领域分文件；事务在这里
  repo.rs      跨命令复用的查询（余额 = SUM(delta)）、insert_ledger（账本只 INSERT）
  settings.rs  setting 表的 JSON 读写与默认值
  tests.rs     内存 SQLite 集成测试（覆盖 02 文档边界用例与 05 文档验收标准）
  seed.rs      仅 debug：演示数据 + JS 注入桥
src/
  lib/api.ts   与 Rust 命令一一对应的类型化封装（字段 camelCase，金额单位分）
  components/  Sidebar / Shell / ui.tsx（Modal、Switch、Stepper、toast、confirm、useAsync）
  routes/      12 屏，一屏一文件；routes/index.tsx 接路由
  styles/      tokens.css（design-tokens.md 生成）、global.css
public/fonts/  Newsreader + Noto Serif SC 本地 woff2
```

## 常用命令
```
pnpm tauri dev                          # 开发
COURSEHOURS_SEED=1 pnpm tauri dev       # 空库时写入演示数据（仅 debug）
pnpm typecheck                          # 前端类型检查
cd src-tauri && cargo test              # Rust 单测 + 集成测试
pnpm tauri build                        # 打 dmg/app（未签名）
```
Rust 通过 rustup 安装，命令前 `source ~/.cargo/env`。

## 三条不能破的原则（来自 spec）
1. `ledger_entry` 只 INSERT，撤销/调整都是写反向 `adjust` 分录。
2. 扣课时数与单价在写入时快照，改设置不回溯。
3. 循环规则只是计划，课次生成后与规则脱钩。
