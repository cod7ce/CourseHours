# 设计变量

从 12 张画板里提炼出来的。建成 `src/styles/tokens.css` 的 CSS 变量，
之后所有组件只用变量，不再写裸色值。

设计方向：**温暖教育感** —— 米白纸感底色、胡桃木深色侧边栏、赤陶色作主色、衬线字给数据分量。

## 颜色

```css
:root {
  /* 底与面 */
  --ground:        #FAF6EF;  /* 应用底色，暖米白 */
  --surface:       #FFFFFF;  /* 卡片 */
  --surface-sunk:  #FBF7F0;  /* 表头、只读输入框 */
  --surface-input: #FDFBF7;  /* 可编辑输入框 */
  --surface-soft:  #F6F1E7;  /* 次级信息块 */

  /* 线 */
  --line:          #EAE1D2;  /* 卡片边框、区块分隔 */
  --line-soft:     #F3ECE1;  /* 表格行分隔 */
  --line-faint:    #F0E8DA;  /* 卡片内分隔 */

  /* 文字 */
  --ink:           #2B2521;  /* 正文 */
  --ink-2:         #4A423A;  /* 次要正文 */
  --ink-3:         #6A6057;  /* 说明文字，4.5:1 达标 */
  --ink-4:         #8C8276;  /* 仅用于 ≥18px 或非关键信息 */

  /* 主色 赤陶 */
  --accent:        #B75E36;  /* 主按钮、激活态、主强调 */
  --accent-deep:   #8F4526;  /* hover、深强调数字 */
  --accent-mid:    #C9764D;  /* 图表柱身 */
  --accent-dark:   #A3502B;  /* 图表当前月柱身 */
  --accent-soft:   #F9EAE0;  /* 浅底标签 */
  --accent-tint:   #FDF7F3;  /* 选中行/卡的极浅底 */

  /* 侧边栏 胡桃木 */
  --nav-bg:        #332A21;
  --nav-card:      #3E3327;  /* 侧栏里的数据小卡 */
  --nav-card-warn: #4A2E24;  /* 告警色的数据小卡 */
  --nav-text:      #C9BDA9;
  --nav-text-dim:  #A99C8B;
  --nav-text-on:   #FFF6EE;  /* 激活项文字 */
  --nav-brand:     #F2E9DB;
  --nav-line:      #453A2E;

  /* 语义 */
  --ok:            #4C6F55;  --ok-soft:    #E6EEE5;  --ok-ink:   #3E5C46;
  --warn:          #8A6011;  --warn-soft:  #F8EBD1;  --warn-ink: #7A5410;
  --danger:        #A33B33;  --danger-soft:#F7E2DE;  --danger-ink:#8C332C;
  --danger-tint:   #FDF6F3;  /* 欠课时行的底色 */

  /* 班级色（同明度、同彩度的一组暖色） */
  --class-1: #B75E36;  /* 赤陶 */
  --class-2: #4C6F55;  /* 苔绿 */
  --class-3: #3F6B6E;  /* 青灰 */
  --class-4: #8C4A63;  /* 梅 */
  --class-5: #92701F;  /* 赭黄 */
  --class-6: #8C8276;  /* 中性，一对一/补课 */

  /* 班级色对应的浅底（课表色块） */
  --class-1-soft: #F9EAE0;  --class-1-line: #E6C6B2;
  --class-2-soft: #E9F0E8;  --class-2-line: #C6D6C4;
  --class-3-soft: #E3EDED;  --class-3-line: #BFD5D5;
  --class-4-soft: #F5E7EC;  --class-4-line: #DEC3CE;
  --class-5-soft: #F6EDD8;  --class-5-line: #E2D0A8;
  --class-6-soft: #F1EADE;  --class-6-line: #DCD1BD;

  /* 交通灯（窗口装饰） */
  --mac-red: #E0705F;  --mac-yellow: #D9A343;  --mac-green: #5FA06A;
}
```

补充变量（上面漏掉但源码里高频出现的，必须一起建）：

```css
:root {
  --line-ctrl:     #E6DCCA;  /* 按钮、输入框的边框。全套设计里第 5 高频的色值 */
  --line-mid:      #EFE7D9;  /* 进度条轨道、深色卡里的分隔 */
  --line-grid:     #E0D5C1;  /* 课表的基线 */
  --dashed:        #D9CDB6;  /* 虚线边框（新建卡片、添加按钮）、开关关闭态轨道 */
  --dashed-soft:   #C2B49E;  /* 课表里临时加课块的虚线 */

  --neutral-soft:  #F1EADE;  /* 中性标签底、头像底 */
  --neutral-ink:   #5A5249;  /* 中性标签文字 */
  --avatar-ink:    #5A4E40;  /* 头像里的姓氏 */
  --circle-soft:   #F3EDE3;  /* 圆形图标底 */
  --leave-line:    #B6A88F;  /* 点名「请假」选中态边框 */
  --ink-on-warn:   #5E4A18;  /* 黄色提示带上的文字 */
  --ink-on-danger: #6B2A24;  /* 红色横幅上的文字 */

  --nav-active-2:  #F1E7DA;  /* 设置页二级导航激活底 */
  --nav-warn-text: #E3B9A6;  /* 侧栏告警卡的标签 */
  --nav-warn-num:  #FBE7DC;  /* 侧栏告警卡的数字 */

  --banner-danger-bg:   #FBEDE9;  --banner-danger-line: #EDCFC7;
  --banner-warn-bg:     #F8EBD1;  --banner-warn-line:   #E8D5AE;

  /* 行底色（表格里的状态标记） */
  --row-danger:   #FDF6F3;  /* 欠课时 */
  --row-warn:     #FDFAF3;  /* 余额不足 */
  --row-neutral:  #FBF9F4;  /* 调整/冲正行 */
  --row-ok:       #FAFBF8;  /* 充值行 */
  --row-today:    #FDF9F3;  /* 课表今天那一列 */
  --col-today-hd: #F9EFE6;  /* 课表今天的列头 */
  --col-today-ln: #F2E8DC;  /* 课表今天那列的小时线 */
  --card-today-line: #DCC4B4; /* 今日页「待点名」卡的边框 */
  --on-danger:    #FFF4F1;  /* 红色实心按钮上的文字 */
}
```

**无障碍**：`--ink-3` 在 `--ground` 上约 5.7:1，达标。`--ink-4` 约 3.3:1，
**只能用于 18px 以上或纯装饰**，不要拿去写正文说明。白字配 `--ok` / `--warn` / `--danger` 均 ≥5.7:1。

## 字体

```css
--font-display: 'Newsreader', 'Noto Serif SC', Georgia, serif;
--font-body:    -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif;
```

**用法规则**：

- `--font-display` 用于：所有数字（余额、金额、课时、日期、时间）、页面 h1、卡片 h2
- `--font-body` 用于：一切正文、标签、按钮、说明
- 数字一律用衬线体，这是整套设计的识别点，别图省事全换成无衬线

| 场景 | 字号 / 字重 |
|---|---|
| 页面标题 h1 | 27px / 600 display |
| 页面副标题 | 12.5px / 400 `--ink-3` |
| 卡片标题 h2 | 16–17px / 600 display |
| 正文 | 13–13.5px |
| 表头 | 11.5px `--ink-3` |
| 说明小字 | 11–11.5px `--ink-3` |
| 大数字（KPI） | 26–36px / 600 display |
| 中数字（表格里的余额） | 16–17px / 600 display |
| 小数字（日期、金额） | 12.5–14px display |

## 尺寸与间距

```css
--radius-card:  14px;   /* 卡片 */
--radius-ctrl:  9–10px; /* 按钮、输入框 */
--radius-chip:  6–8px;  /* 标签 */
--radius-pill:  11–16px;/* 胶囊标签、筛选 chip */

--sidebar-w:    216px;
--header-h:     80px;
--page-pad:     20–24px 32px;   /* 内容区内边距 */
--card-pad:     16–22px 18–24px;
--gap-card:     14–18px;        /* 卡片之间 */
```

**控件高度**（桌面指针目标，不套用移动端 44px）：

| 控件 | 高度 |
|---|---|
| 侧边栏导航项 | 38px |
| header 按钮 / 输入框 | 36px |
| 主操作按钮（底部确认） | 40–42px |
| 表格行 | 46–56px |
| 点名的状态按钮 | 30px × 54px |
| 筛选 chip | 32px |
| 加减器 | 34px |
| 开关 | 42×24px，滑块 20px |

## 组件规格

**卡片**：`background: var(--surface); border: 1px solid var(--line); border-radius: 14px;`
不要加阴影，只有「当前待办」的卡例外（今日页待点名那张）：
`box-shadow: 0 1px 0 #F2E3D8, 0 6px 18px -12px rgba(120,70,40,.45)`

**表格**：不用 `<table>`，用 flex 行。表头 `--surface-sunk` 高 36–40px，行之间 `border-top: 1px solid var(--line-soft)`。
数字列右对齐。欠课时的行整行 `--danger-tint` 底。

**标签（pill）**：`height: 21–22px; padding: 0 8–9px; border-radius: 6px;` 配 `-soft` 底 + `-ink` 字。

**开关**：一个视觉上的 track + knob，里面藏一个真实的 `<input type="checkbox">`（`position:absolute; opacity:0`），
整体包在 `<label>` 里。**不要用 div + onClick 造假开关**，Tab 键会跳过去。

**图标**：一律 inline SVG，`stroke="currentColor"`，`stroke-width="1.7"`（导航）或 `1.8–2`（小图标），
`stroke-linecap="round"`。**不用 emoji 当图标**。

## 深色模式

**MVP 不做。** 这套色板是围绕暖米白设计的，深色版要重新选一遍色，
不是把颜色取反能了事的。要做的话单独排期，在 tokens 里加一层 `@media (prefers-color-scheme: dark)` 重定义。
