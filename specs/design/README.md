# 设计图怎么读

`artboards/` 里是 12 张设计图的**完整 HTML 源码**，不是截图。
色值、字号、间距、圆角、文案全部是精确值，直接从源码里取，**不要凭截图目测**。

## 做每一屏之前

```bash
cat specs/design/artboards/Roster.dc.html
```

然后把 `<x-dc>` 里的 DOM 结构和内联样式搬进 React 组件。内联样式里的每一个数字都是设计决定过的。

## 文件格式说明

这些文件是 Claude 的 Design 画布格式（`.dc.html`），是标准 HTML 加几个模板标记。
搬运时按下面这张表处理：

| 源码里的东西 | 怎么处理 |
|---|---|
| `<x-dc>` … `</x-dc>` | 外壳，去掉。里面的 DOM 就是界面 |
| `<helmet><style>` | 全局样式（body 背景、字体、链接色），搬到全局 CSS |
| `<link href="fonts.googleapis.com/...">` | 字体，见下方「字体」一节 |
| `style="…"` 内联样式 | **照抄**。所有色值和尺寸都在这里 |
| `{{ foo }}` | 模板占位，替换成 React 表达式 `{foo}` |
| `<sc-for list="{{ rows }}" as="row">` | 列表渲染，替换成 `rows.map(row => …)` |
| `<sc-if value="{{ cond }}">` | 条件渲染，替换成 `{cond && …}` |
| `onClick="{{ handler }}"` | 事件绑定，替换成 `onClick={handler}` |
| `<script data-dc-script>` 里的 `class Component extends DCLogic` | **重要**，见下 |
| `hint-placeholder-*` 属性 | 画布编辑器专用，删掉 |
| 顶部 `<script src="./support.js">` | 画布运行时，删掉 |

## `<script data-dc-script>` 块 = 行为规格

三个画板的 script 块里写了**可运行的真实交互逻辑**，是比文字描述更准确的规格，
实现时直接翻译成 React state + 事件处理：

| 画板 | script 块里实现了什么 |
|---|---|
| `Roster.dc.html` | 四态点名、按规则算扣课时、实时算扣后余额和欠课时、底部合计与警示文案 |
| `Recharge.dc.html` | 课次÷金额算单价、两种欠课时处理方式的分支、「将写入的流水」预览 |
| `Settings.dc.html` | 五个分区切换、各项加减器与开关、规则预览句子的实时拼装、按当前设置试算 |
| `Scheduling.dc.html` | 提前周数 → 将生成课次数与日期区间的实时计算 |

其余画板的 script 块是空的（`renderVals() { return {}; }`），纯静态设计稿。

里面的 mock 数据（学生名、余额、金额）是演示数据，**不要当成种子数据**，但可以照着造测试夹具 ——
它们内部是自洽的（比如林小满余额 −2，在点名页、学生列表、流水页、班级名册里都是 −2）。

## 字体

设计用了两款 Google Fonts：

- **Newsreader** — 所有数字、日期、金额、标题。衬线，给数据一点分量
- **Noto Serif SC** — 中文标题

正文中文用系统字体栈：`-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif`。

**桌面应用里不要运行时去 Google Fonts 拉字体**（离线就废了）。
把 Newsreader 和 Noto Serif SC 的 woff2 下载下来打进包，用 `@font-face` 本地加载。
Noto Serif SC 全字重很大，只打包 500/600/700 三个字重，或者做 subset。

## 画板与界面的对应

| 画板 | 界面 | 交互 | 备注 |
|---|---|---|---|
| `Main.dc.html` | 今日总览 | 静态 | 入口页 |
| `Roster.dc.html` | 点名扣课时 | ★ 完整 | 核心 |
| `Schedule.dc.html` | 课表周视图 | 静态 | 课块用绝对定位，`top = (小时-9)*52px` |
| `Scheduling.dc.html` | 排课 | ★ 部分 | 循环规则 + 批量生成 |
| `Students.dc.html` | 学生列表 | 静态 | 按余额升序 |
| `StudentDetail.dc.html` | 学生详情 | 静态 | 流水 + 课包 |
| `Recharge.dc.html` | 登记充值 | ★ 完整 | 抵扣逻辑 |
| `Reports.dc.html` | 经营报表 | 静态 | 图表是纯 div，无图表库 |
| `Classes.dc.html` | 班级列表 | 静态 | 3 列卡片 |
| `ClassDetail.dc.html` | 班级详情 | 静态 | 名册 + 最近课次 |
| `Ledger.dc.html` | 全机构流水 | 静态 | 六种记录类型各一行示例 |
| `Settings.dc.html` | 设置 | ★ 完整 | 五个分区 |

`_canvas.json` 是画布的布局索引（每张图在画布上的坐标和标题），实现时用不到，留作对照。

## 图表

报表页的两组图是**纯 div + 内联样式**画的，没有用任何图表库：

- 柱状图：外层 `position: relative` 容器 + 绝对定位的网格线 + flex 排列的柱子，
  柱高 = `值 / 刻度上限 × 168px`，柱子 `border-radius: 4px 4px 0 0`
- 横条图：`background` 做轨道，内层 div 用百分比宽度做填充

实现时**建议保持这个做法**，不要引入 Recharts/ECharts：这两个图形态固定、数据量小，
装图表库要花更多时间去覆盖它的默认样式。

## 想看最新版设计

这批文件是从 Claude 画布导出的快照。若实现过程中设计有更新，
在有 Artifact 工具的 session 里可以读到最新版：

```
Artifact  action="read"  url="https://claude.ai/artifact/7i7yq9jvTQPgu73N1KiUSv"
          path="project/Roster.dc.html"
```

如果实现 session 没有这个工具，以本目录的快照为准。
