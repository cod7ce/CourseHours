# 04 · 技术选型

## 推荐：Electron + React + TypeScript + better-sqlite3

```
Electron 3x          桌面外壳
React 19 + TS        渲染层
Vite                 构建（electron-vite）
better-sqlite3       数据库驱动（同步 API）
Kysely               类型安全的 SQL 构建器（可选，见下）
Zustand              前端状态
TanStack Router      路由
electron-builder     打包 + 公证
Vitest               单元测试
```

### 为什么是 Electron 而不是别的

你的要求是「成熟的桌面框架，让实现更简单」。按这个标准排序：

| 方案 | 成熟度 | 实现难度 | 包体积 | 适合度 |
|---|---|---|---|---|
| **Electron** | 最高，十年生态 | 最低，全 TypeScript 一种语言 | ~150 MB | ✅ 推荐 |
| Tauri 2 | 高 | 中，后端要写 Rust | ~15 MB | 备选 |
| SwiftUI + GRDB | 高 | 中高，Swift + 没有设计稿到代码的直通路径 | ~5 MB | 不推荐 |

选 Electron 的三个具体理由：

1. **设计图就是 HTML。** `design/artboards/*.dc.html` 里的内联样式可以近乎逐行搬进 React 组件。换任何非 Web 技术栈都要重画一遍。
2. **一种语言。** 主进程、渲染进程、数据库层全是 TypeScript。单人项目里少一门语言 = 少一半心智负担。
3. **AI 实现最顺。** Electron + React + better-sqlite3 是训练数据最密集的组合，生成的代码正确率最高、踩坑最少。

体积和内存是真实代价，但这是一个老师一天开几次的本地工具，不是常驻后台的东西。不值得为此换 Rust。

> 如果你后面确实在意体积/启动速度，Tauri 2 是干净的升级路径：前端代码几乎不用动，
> 把 `better-sqlite3` 的那一层换成 `tauri-plugin-sql` 或自己写 Rust command 即可。
> 建议**先用 Electron 跑通，再考虑要不要迁**。

### 为什么是 better-sqlite3

- **同步 API**。单用户本地库，没有并发压力，同步调用让点名那个多步事务写起来是直白的顺序代码，不用和 async/await + 事务边界搏斗。
- 性能远超 `node-sqlite3`（后者是异步包装，反而更慢）
- 原生模块，需要 `electron-rebuild`，`electron-vite` 模板里已经处理好

### ORM 还是裸 SQL

**建议 Kysely（类型安全的 query builder），不要用 Prisma / TypeORM。**

- 账本逻辑需要显式事务、显式 `INSERT`、精确控制查询，重 ORM 只会碍事
- Kysely 只是给 SQL 加类型，不隐藏 SQL，schema 类型手写一份（8 张表，一次性成本很低）
- 聚合查询（余额、报表）直接写原生 SQL，Kysely 支持 `sql` 模板标签

如果嫌 Kysely 也麻烦，直接 better-sqlite3 + 手写 SQL + 手写 row 接口也完全可行，8 张表的规模撑得住。

---

## 项目结构

```
.
├── specs/                        ← 本目录，只读参考
├── electron/
│   ├── main.ts                   主进程：窗口、菜单、生命周期
│   ├── preload.ts                contextBridge 暴露 API
│   └── ipc/                      按领域分的 IPC handler
│       ├── students.ts
│       ├── classes.ts
│       ├── scheduling.ts
│       ├── rollcall.ts
│       ├── ledger.ts
│       ├── reports.ts
│       └── settings.ts
├── src/
│   ├── main.tsx
│   ├── routes/                   一个路由一个目录，对应 03 文档的 12 屏
│   ├── components/               跨屏复用：Sidebar / StatTile / LedgerRow / Stepper / Switch
│   ├── styles/tokens.css         ← 从 design/design-tokens.md 生成
│   └── lib/
├── db/
│   ├── schema.ts                 Kysely 类型定义
│   ├── migrations/
│   │   └── 001_init.sql          ← 直接用 01 文档的 DDL
│   ├── connection.ts
│   └── repositories/             每张表一个，只做 CRUD
├── core/                         ★ 纯函数业务逻辑，不依赖 Electron / DB
│   ├── hours.ts                  扣课时计算、规则应用
│   ├── packages.ts               FIFO 选包、单价结转
│   ├── balance.ts                余额推导、欠课时
│   ├── recharge.ts               充值与抵扣的两种方式
│   ├── scheduling.ts             按规则展开日期
│   └── reports.ts                报表口径
└── tests/
    └── core/                     ★ 02 文档里每个「边界用例」表格 = 一个测试
```

**`core/` 是纯函数层，这是整个架构里唯一重要的决定。**
扣课时、FIFO 选包、抵扣、排课展开，全部写成不碰数据库的纯函数，输入是普通对象，输出是「要写哪些行」的描述。
仓储层拿到描述去执行事务。这样 02 文档里那些边界用例可以直接写成单测，不需要建库。

---

## 数据与文件

- 数据库：`app.getPath('userData')/data.db`
- 备份：`userData/backups/YYYY-MM-DD-HHmm.db`，用 SQLite 的 `VACUUM INTO` 做一致性快照
- 保留份数按 `setting['backup'].keep`，超出的删最旧
- 导出 CSV 用 `dialog.showSaveDialog`，UTF-8 带 BOM（Excel 打开中文不乱码）

## 打包

- `electron-builder`，target `dmg` + `zip`（zip 给自动更新留口子）
- 自签名先跑通，正式分发再办 Apple Developer 账号做公证
- 单用户自用的话，`--config.mac.identity=null` 跳过签名也能装（首次打开右键→打开）

## 不要引入的东西

- 任何后端服务 / HTTP server
- 任何云同步 / 账号体系
- Redux（Zustand 够了）
- UI 组件库（设计图是自定义的，装 MUI/Antd 反而要大量覆盖样式）
- ORM 的 migration 生成器（8 张表，手写 SQL migration 更可控）
