# 课时统计与消费系统 — Spec

一个给英语小班教学（每班 10 人以内、多班、不同时间点上课）用的 macOS 桌面应用。
单用户（老师 / 主理人本人），数据只存本机。

这套 spec 是**给实现者（人或 AI session）读的**，不是给产品评审用的。
每篇都尽量做到「读完就能动手」，规则部分带边界用例。

## 文档索引

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| [`00-overview.md`](00-overview.md) | 产品范围、非目标、术语表 | 开工前先读，统一名词 |
| [`01-domain-model.md`](01-domain-model.md) | 8 张表的 DDL、字段语义、不变量 | 建库前必读 |
| [`02-business-rules.md`](02-business-rules.md) | 扣课时 / 欠课时 / 抵扣 / 撤销 / 排课 的完整规则与伪代码 | **最重要**，写业务逻辑前逐条读 |
| [`03-screens.md`](03-screens.md) | 12 个界面逐屏规格：数据来源、交互、空状态 | 写 UI 时按屏查 |
| [`04-tech-stack.md`](04-tech-stack.md) | 技术选型、项目结构、关键依赖 | 搭架子时读 |
| [`05-implementation-plan.md`](05-implementation-plan.md) | 分 8 个阶段的实现顺序与验收标准 | 排任务时读 |
| [`design/README.md`](design/README.md) | **设计图怎么读** | 写任何 UI 之前先读这篇 |
| [`design/design-tokens.md`](design/design-tokens.md) | 色板、字体、间距、组件规格 | 建立样式系统时读 |
| [`design/artboards/`](design/artboards/) | 12 张设计图的 HTML 源码 | 做每一屏时 `cat` 对应文件 |

## 给实现 session 的开场指令（可直接复制）

> 读 `specs/README.md`、`specs/00-overview.md`、`specs/01-domain-model.md`、
> `specs/02-business-rules.md`、`specs/04-tech-stack.md`，
> 然后读 `specs/design/README.md` 和 `specs/design/design-tokens.md`。
> 按 `specs/05-implementation-plan.md` 的阶段顺序实现。
> 做每一屏之前，先 `cat` 对应的 `specs/design/artboards/<Name>.dc.html`，
> 从源码里取精确的色值、字号、间距和文案，不要凭印象重画。

## 三条贯穿全局的原则

1. **账本 append-only。** 余额不是一个字段，是流水的累加。任何"改错了"都靠写新的冲正分录解决，历史行永不修改、永不删除。
2. **规则在写入时快照。** 每条扣课时记录存下当时扣了多少课时、按哪个包的单价结转。之后改设置不回溯历史。
3. **排课规则只是计划，课次才是实体。** 规则生成课次，生成之后两者脱钩：改规则不动已生成的课，改课次不动规则。
