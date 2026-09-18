# 02 · 业务规则

本篇是这个系统真正复杂的地方。每条规则给出：规则本身 → 伪代码 → 边界用例。

---

## R1 扣课时

### 规则

点名时每个学生取四态之一，扣多少课时查 `setting['hours_rule']`：

| 状态 | 默认扣 | 含义 |
|---|---|---|
| `present` 出勤 | 1 | 来了 |
| `late` 迟到 | 1 | 来了但晚 |
| `leave` 请假 | 0 | 家长提前说过 |
| `absent` 缺勤 | 0 | 没来也没说 |

四个数都可在设置里改（0–4）。**请假和缺勤默认都不扣，但必须保持为两个独立状态** —— 它们对出勤率和"要不要找家长"的意义不同。

余额不足**不拦截**（`allowNegative = true`），扣成负数就是欠课时。
若用户把 `allowNegative` 关掉，点名时余额 < 应扣数的学生要拦下并提示先充值。

### 扣哪个课包（FIFO）

按 `purchased_on ASC, created_at ASC` 先买先扣。

```
function pickPackage(studentId, needHours):
  packages = SELECT * FROM package WHERE student_id = ? ORDER BY purchased_on, created_at
  for p in packages:
    used = SUM(-delta) FROM ledger_entry
           WHERE package_id = p.id AND type = 'consume'
    remaining = p.sessions - used
    if remaining >= needHours: return p          // 够扣
  return null                                     // 所有包用尽 → 这次扣的是欠课时
```

`ledger_entry.package_id` 记录这一次扣的是哪个包。全部用尽时为 `NULL`，表示欠课时。

> **简化说明**：不处理「一次扣课时跨两个包」的情况。因为每次只扣 0–1 课时，
> 而包的剩余量是整数，跨包只会在允许小数课时时出现。若日后开放 0.5 课时，
> 在 `pickPackage` 里改成拆成两条 consume 分录即可。

### 结转收入

`ledger_entry.amount_cents = hours × 该包的 unit_price_cents`。
扣的是欠课时（`package_id = NULL`）时，单价按 `setting['hours_rule'].owedPriceMode`：
- `package`（默认）：最后一个用尽的包的单价
- `latest`：该学生最近一次充值的单价

### 点名事务

```
function confirmRollCall(sessionId, marks /* [{studentId, status}] */):
  BEGIN IMMEDIATE
    session = SELECT * FROM session WHERE id = ? 
    assert session.status == 'planned'            // 已点过名或已取消的不能再点
    rule = settings.hours_rule
    now = Date.now()

    UPDATE session SET status='taken', taken_at=now, updated_at=now

    for m in marks:
      hours = rule[m.status]                      // 快照
      INSERT attendance(session_id, student_id, status, hours)

      pkg = pickPackage(m.studentId, hours)
      bal = currentBalance(m.studentId) - hours
      INSERT ledger_entry(
        student_id  = m.studentId,
        occurred_at = now,
        type        = 'consume',
        delta       = -hours,
        balance_after = bal,
        session_id  = sessionId,
        package_id  = pkg?.id,
        amount_cents = round(hours * unitPriceFor(m.studentId, pkg)),
        reason      = `${class.name} ${session.start_time} · ${label(m.status)}`
      )
  COMMIT
```

整个点名是**一个事务**。中途失败全部回滚，不允许出现"扣了一半"的状态。

### 边界用例

| 场景 | 期望 |
|---|---|
| 学生余额 2，全班 9 人出勤 | 该生变 1，其余各扣 1，共扣 9 |
| 学生余额 0，出勤 | 变 −1，流水 `package_id = NULL`，界面显示"欠 1 课时" |
| 学生余额 −2，请假 | 变 −2（delta = 0），仍写一条分录 |
| 同一课次重复点名 | 第二次抛错：`session.status != 'planned'` |
| 点名时某学生已 `left_on` 退班 | 不出现在名单里；若临时加人则手动加进 marks |
| `allowNegative = false` 且余额不够 | 整个事务拒绝，返回哪几个学生不够 |

---

## R2 欠课时

- 余额为负就是欠课时，欠多少 = `-balance`
- 欠课时**没有上限**，不拦截上课，只在界面上标红
- 欠课时到 `setting['alerts'].owedAlertThreshold`（默认 5）时，点名界面给一条提示（不拦截）
- 欠款折算成钱：`欠课时 × 单价`，单价按 `owedPriceMode`
- 报表里欠课时是**应收账款**，和未消耗课时（教学负债）分开列，**不做净额**

---

## R3 充值与抵扣 ★

### 输入只有两个数

充值表单只填「课次」和「总金额」。单价 = `ROUND(amount_cents / sessions)`，现算并存进 `package.unit_price_cents`。
没有"单价"这个可编辑字段，也没有全局单价设置。

### 两种欠课时处理方式

假设学生当前余额 `−2`，本次充 10 课次 ¥1,000：

**方式 A · 从本次充值中抵扣（默认，`autoOffsetOnRecharge = true`）**

```
INSERT package(sessions=10, amount_cents=100000, unit_price_cents=10000,
               offset_sessions=min(2, 10))
INSERT ledger_entry(type='recharge', delta=+10, balance_after=8,
                    package_id=…, amount_cents=100000,
                    reason='课包 10 课次 · ¥1,000')
```

余额自然从 −2 变成 8。**不写额外的"抵扣 −2"分录** —— `−2 + 10 = 8` 里已经含了抵扣，
再记一条就是重复扣两次。抵扣的事实体现在两处：
1. `package.offset_sessions = 2`，收据和流水详情用它显示"其中 2 课次用于结清欠课时"
2. 余额从负数跳到正数这个事实本身

实收 = `amount_cents` = ¥1,000。

**方式 B · 欠款另行补缴**

家长额外付清欠的 2 课时（按 `owedPriceMode` 折算 ¥300），本次 10 课次全保留：

```
INSERT ledger_entry(type='adjust', delta=+2, balance_after=0,
                    amount_cents=30000, reason='结清此前欠 2 课时')
INSERT package(sessions=10, amount_cents=100000, offset_sessions=0)
INSERT ledger_entry(type='recharge', delta=+10, balance_after=10, …)
```

余额变 10。实收 = ¥1,300。

### 边界用例

| 场景 | 期望 |
|---|---|
| 余额 −5，充 3 课次 | 方式 A：余额 −2，`offset_sessions = 3`，仍欠 2 |
| 余额为正时充值 | `offset_sessions = 0`，两种方式等价，界面不显示抵扣选项 |
| 课次填 0 或金额填 0 | 表单校验拒绝 |
| 金额除不尽（7 课次 ¥1,000） | `unit_price_cents = 14286`（四舍五入）；结转时用它，累计误差用最后一笔兜底或直接接受（单用户场景可接受） |

---

## R4 撤销与调整

两个入口，**同一个机制**：都是往账本里写一条 `adjust` 分录，`reverses_id` 指向原分录。
原分录永不修改。

| | 撤销 | 手动调整 |
|---|---|---|
| 入口 | 流水行上的「撤销」链接 | 学生详情的「手动调整课时」按钮 |
| 时限 | `undoWindowDays` 天内（默认 7），且只对最近的 consume / recharge | 无时限 |
| delta | 自动取原分录的相反数 | 手填 |
| reason | 自动生成，如"撤销 9-15 点名" | 手填，必填 |
| 已被冲正过的分录 | 不能再撤销 | 可以再调整 |

撤销一条 `consume` 分录时，还要级联：

```
BEGIN
  INSERT ledger_entry(type='adjust', delta=-orig.delta,
                      balance_after=currentBalance + (-orig.delta),
                      reverses_id=orig.id, session_id=orig.session_id,
                      amount_cents=-orig.amount_cents,       // 收入也冲回
                      reason='撤销 ' + fmt(orig.occurred_at) + ' 点名')
  DELETE FROM attendance WHERE session_id=? AND student_id=?   // 出勤率要跟着改
  -- 若该课次所有人的点名都被撤销，把 session.status 退回 'planned'
COMMIT
```

> attendance 是可以删的（它不是账本），账本行不可删。
> 收入冲回时 `amount_cents` 取负，报表按 `SUM(amount_cents)` 统计自然正确。

### 边界用例

| 场景 | 期望 |
|---|---|
| 撤销 8 天前的点名 | 「撤销」链接不显示；只能走手动调整 |
| 撤销一条已被撤销的分录 | 拒绝 |
| 撤销后再点一次名 | session 已退回 planned，可以重新点 |
| 手动调整 delta = 0 | 拒绝，没有意义 |

---

## R5 排课

### 两层模型

**规则（`recurrence_rule`）只是计划，课次（`session`）才是实体。**
生成之后两者脱钩：改规则不动已生成的课，改课次不动规则。

### 批量生成

```
function generate(from /* YYYY-MM-DD */, weeks):
  to = from + weeks*7 - 1
  created = []
  for rule in SELECT * FROM recurrence_rule WHERE active = 1:
    for date in datesBetween(from, to):
      if isoWeekday(date) not in rule.weekdays: continue
      // UNIQUE(class_id, date, start_time) 保证幂等
      INSERT OR IGNORE INTO session(
        class_id=rule.class_id, rule_id=rule.id, date=date,
        start_time=rule.start_time, end_time=rule.end_time,
        room=rule.room, kind='regular', status='planned')
      created.push(...)
    UPDATE recurrence_rule SET generated_through = to WHERE id = rule.id
  return created
```

- **幂等**：重复点「立即生成」不会造重复课次
- `from` 默认取 `MAX(generated_through) + 1 天`，没有则取今天
- 自动生成（`scheduling.autoGenerate`）：每周一启动时跑一次，始终保持提前 `leadWeeks` 周
- **不跳过法定节假日**。生成前在预览区提示用户哪几天是假期，让他生成后手动取消

### 冲突检测

生成前检查同一 `room` + `date` + 时段重叠的课次，有冲突就在预览里标出来，但**不阻止生成**（老师可能确实两个班挤一间教室）。

### 取消单次课

```
UPDATE session SET status='cancelled', cancel_reason=?, updated_at=now
```

- **不顺延**，不补生成
- 不产生任何 attendance 或 ledger_entry
- 课表上保留为灰色划线块
- 已 `taken` 的课次不能取消（先撤销点名）

### 临时加课

```
INSERT session(class_id=?, rule_id=NULL, kind='extra', date=?, start_time=?, …)
```

谁上这节课在点名时定 —— 可以是全班，也可以只加一个学生（界面上的"临时加人"）。
一对一补课就是「加一节 extra 课次 + 点名时只有他一个人」。

### 边界用例

| 场景 | 期望 |
|---|---|
| 重复点生成 | 不产生重复，`created` 返回空 |
| 改规则时间后再生成 | 已生成的旧课次时间不变；新生成的用新时间 |
| 停用规则 | 不再生成新课；已生成的课次照常存在 |
| 取消后又想上 | 没有"恢复"，重新临时加课一节 |

---

## R6 报表口径

| 指标 | 算法 |
|---|---|
| 课消课时 | `SUM(-delta) FROM ledger_entry WHERE type='consume' AND occurred_at IN 区间` |
| 课消收入（已确认） | `SUM(amount_cents) FROM ledger_entry WHERE type='consume' AND occurred_at IN 区间`（含 adjust 的负数冲回） |
| 充值收款 | `SUM(amount_cents) FROM ledger_entry WHERE type='recharge' AND occurred_at IN 区间` |
| 出勤率 | `COUNT(status IN ('present','late')) / COUNT(*) FROM attendance JOIN session ON … WHERE session.date IN 区间` |
| 班级加权均价 | `课消收入 / 课消课时`（班内不同学生单价不同，只能给加权值） |
| 未消耗课时 | 每个学生 `balance > 0` 的部分求和 |
| 欠课时 | 每个学生 `balance < 0` 的部分取绝对值求和 |
| 未消耗预收款 | 每个学生正余额 × 其最近课包单价，求和（近似值，界面上要标明是估算） |

**充值收款 ≠ 课消收入。** 前者是现金流，后者是权责发生制下确认的收入。两个数都要给，别合并。
