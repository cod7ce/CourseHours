# 03 · 界面规格

12 屏。每屏对应 `design/artboards/` 里的一个 `.dc.html` 文件 —— **写代码前先 `cat` 那个文件**，
色值、字号、间距、文案都以源码为准，本篇只写源码里看不出来的东西：数据从哪来、点了会怎样、空状态长什么样。

窗口 1360×880。侧边栏固定 216px（深胡桃木 `#332A21`），右侧内容区 header 80px + body。

| 屏 | 画板文件 | 路由 |
|---|---|---|
| 今日 | `Main.dc.html` | `/` |
| 点名 | `Roster.dc.html` | `/sessions/:id/roll-call` |
| 课表 | `Schedule.dc.html` | `/schedule` |
| 排课 | `Scheduling.dc.html` | `/schedule/planning` |
| 学生列表 | `Students.dc.html` | `/students` |
| 学生详情 | `StudentDetail.dc.html` | `/students/:id` |
| 登记充值 | `Recharge.dc.html` | `/students/:id/recharge` |
| 经营报表 | `Reports.dc.html` | `/reports` |
| 班级列表 | `Classes.dc.html` | `/classes` |
| 班级详情 | `ClassDetail.dc.html` | `/classes/:id` |
| 课时流水 | `Ledger.dc.html` | `/ledger` |
| 设置 | `Settings.dc.html` | `/settings/:section` |

---

## 今日 `/`

**数据**
- 今日课次：`SELECT * FROM session WHERE date = today AND status != 'cancelled' ORDER BY start_time`
- 每节课的人数：该班当前 `enrollment WHERE left_on IS NULL` 计数
- 待点名的课次要预算「本次预计扣 N 课时」和「谁扣后为负」
- 课时预警：所有 `balance <= alerts.lowBalanceThreshold` 的在读学生，按余额升序，取前 3
- 最近动态：`ledger_entry` 按 `occurred_at DESC` 取 5，加上 session 的取消/加课记录
- 本月概览：见 02 文档 R6

**交互**
- 待点名的课 → 主按钮「开始点名」跳 `/sessions/:id/roll-call`
- 已点名的课 → 「查看」跳同一路由的只读态
- 预警行的「充值」→ `/students/:id/recharge`

**空状态**
- 今天没课：课程区显示「今天没有排课」+ 「去课表看看这周」链接
- 无预警：预警卡整张不显示，本月概览上移

---

## 点名 `/sessions/:id/roll-call`

**最重要的一屏。** 交互逻辑在画板源码的 `<script data-dc-script>` 块里有完整实现，直接参照。

**数据**
- session + klass + 该班在读学生名单（含每人当前 balance）
- 规则从 `setting['hours_rule']` 读，渲染成顶部那条黄色提示带

**交互**
- 每个学生一行四个状态按钮，默认全选「出勤」
- 选中状态实时算：本人扣后余额、是否为负（红底 + "欠 N 课时"标签）、底部合计
- 「全部标记出勤」重置所有人
- 「临时加人」：从不在本班的学生里选一个加进本次名单（不改 enrollment）
- 「本次不上课」= 取消该课次，回到今日页
- 「确认扣课时」走 R1 的事务

**状态**
- `session.status = 'taken'`：整页只读，底部换成「撤销本次点名」（在 `undoWindowDays` 内）
- `session.status = 'cancelled'`：不可进入，跳回课表

---

## 课表 `/schedule`

**数据**
- `SELECT * FROM session WHERE date BETWEEN 周一 AND 周日` + klass 的 color
- 块的垂直位置：`top = (startHour - 9) * 52px`，高度 = 时长换算。可见时段 09:00–21:00

**交互**
- 左右箭头翻周，「本周」回到当周
- 点课块：`planned` 跳点名；`taken` 跳只读点名；`cancelled` 弹取消原因
- 右上「排课」跳 `/schedule/planning`
- 拖拽调整单次课时间（P2 可以先不做，做成点开弹窗改时间）

**画法**
- 今天那一列整列淡橙底，日期做成实心圆
- `cancelled` 的块：灰底 + 文字划线
- `extra`（临时加课）的块：虚线边框

---

## 排课 `/schedule/planning`

**数据**
- 所有 `active` 的循环规则 + 各自 `generated_through`
- 预览：按 R5 的 `generate` 干跑一遍（不写库），返回将生成的课次，按班分组计数
- 最近的手动调整：`session WHERE status='cancelled' OR kind='extra'`，按 `updated_at DESC` 取 5

**交互**
- 「提前生成 N 周」加减器 → 预览实时重算
- 「自动生成」开关写 `setting['scheduling'].autoGenerate`
- 「立即生成」执行 R5，成功后刷新 `generated_through`，toast 显示生成了几节
- 节假日提醒：生成区间里若含法定节假日（本地静态表即可），显示黄色提示卡

---

## 学生列表 `/students`

**数据**：在读学生 + 每人 balance + 本月出勤 + 最近上课日 + 应补缴金额，**按 balance 升序**（欠得最多的排最前）

**筛选**：全部 / 已欠课时（`balance < 0`）/ 余额不足（`0 <= balance <= threshold`）/ 本月新增 / 已停课

**交互**：整行点击进详情；「充值」按钮直接进充值页

**性能**：balance 是 `SUM(delta)` 聚合，学生多了要给 `ledger_entry(student_id)` 建索引（已有），或做一张 `student_balance` 物化视图在写入时更新。47 人规模下直接聚合完全够。

---

## 学生详情 `/students/:id`

**数据**
- 学生档案 + 当前 balance + 累计消耗（`SUM(-delta) WHERE type='consume'`）+ 本月出勤
- 课包列表（按购买时间倒序），当前包的已用/总数
- 流水：`ledger_entry WHERE student_id = ? ORDER BY occurred_at DESC`，分页

**交互**
- 余额为负时顶部红色横幅，按钮进充值页
- 流水行：`undoWindowDays` 内的最近 consume/recharge 显示「撤销」
- 被冲正过的行加删除线
- recharge 行下方缀一行小字说明抵扣了几课次（读 `package.offset_sessions`）

---

## 登记充值 `/students/:id/recharge`

交互逻辑同样在画板源码的 script 块里有完整实现。

**表单**：课次（int > 0）、总金额（分）、日期、收款方式、备注
**自动计算**：折合单价 = 金额 ÷ 课次，实时显示
**欠课时处理**：余额 < 0 时显示两个单选（方式 A / 方式 B，见 R3）；余额 ≥ 0 时整块隐藏
**右侧**：本次结算汇总 + 「将写入的流水」预览（1–2 条，随方式切换）
**预设**：从 `setting['defaults'].packagePresets` 读，点一下填入两个数

---

## 经营报表 `/reports`

**数据**：全部按 02 文档 R6 的口径算，按月
**图表**：近 6 个月课消课时（单系列柱状，当月加深并直接标值）；班级满员度（单色横条）
**表格**：班级课消明细，末行合计
**侧边栏**：未消耗课时（预收）和已欠课时（应收）两张卡，**不合并**
**导出**：CSV，一行一个班，加合计行

---

## 班级列表 `/classes`

**数据**：`active` 班级 + 各自在班人数/上限、本月课次数、课消课时、课消收入、已上课次数、`generated_through`
**卡片**：3 列网格，最后一格是虚线的「新建班级」
**角标**：班里有人欠课时 → 红标；有人余额为 0 → 黄标

## 班级详情 `/classes/:id`

**左**：名册表（入班日期、余额、本月出勤、累计上课、移出班级）
**右**：最近课次列表（今天那节高亮，点进去就是点名）+ 班级设置摘要
**移出班级**：写 `enrollment.left_on`，不删数据，二次确认

## 课时流水 `/ledger`

**数据**：全机构 `ledger_entry` JOIN student/klass/session，按 `occurred_at DESC` 分页
**筛选**：类型（消费/充值/请假缺勤/调整）、班级、学生姓名搜索、月份
**顶部四个数**：本月充值 / 本月课消 / 手动调整 / 期末结存（结存那格要同时显示欠课时，两个数不相加）
**导出**：CSV，字段与表格列一致

## 设置 `/settings/:section`

五个分区，二级菜单切换：`rules` / `alerts` / `packs` / `org` / `data`。
每个分区对应 `setting` 表的一个 key。改动先进内存，点「保存设置」才落库；顶部显示「有未保存的改动」。
「规则预览」卡片实时用当前表单值拼出点名页顶部那句话 —— 这个联动在画板源码里已实现，照抄。

---

## 全局交互约定

- **所有破坏性操作二次确认**：取消课次、移出班级、清空数据、撤销点名
- **toast 提示**：成功操作右上角 toast，3 秒消失
- **加载态**：本地 SQLite 查询都在毫秒级，不做骨架屏，超过 200ms 才显示 spinner
- **错误**：业务规则拒绝（如重复点名）用内联红字说明原因，不用弹窗
- **键盘**：`⌘,` 打开设置，`⌘F` 聚焦搜索，点名页 `1/2/3/4` 给当前行打状态
