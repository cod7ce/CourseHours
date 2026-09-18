# 01 · 数据模型

SQLite。所有 DDL 可直接作为第一份 migration。

约定：
- 主键用 TEXT 存 UUID v4（不用自增整数，方便日后导出合并）
- 日期用 `TEXT` `YYYY-MM-DD`，时刻用 `TEXT` `HH:MM`，时间戳用 `INTEGER` unix 毫秒
- **金额一律用 `INTEGER` 存「分」**，禁止浮点存钱
- 课时用 `REAL`，因为规则允许设成 0.5（目前默认都是整数）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

---

## 1. student 学生

```sql
CREATE TABLE student (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  en_name       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | paused | left
  enrolled_on   TEXT NOT NULL,                    -- YYYY-MM-DD 入学日期
  guardian_name TEXT,
  phone         TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_student_status ON student(status);
```

`status`：`active` 在读 / `paused` 已停课（保留数据和余额）/ `left` 已退班。
退班不删数据，余额和流水永久保留。

## 2. klass 班级

```sql
CREATE TABLE klass (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,                     -- #RRGGBB，课表色块和圆点用
  room         TEXT,
  capacity     INTEGER NOT NULL DEFAULT 10,
  duration_min INTEGER NOT NULL DEFAULT 90,
  status       TEXT NOT NULL DEFAULT 'active',    -- active | ended
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

班级**没有**「计划课次总数」字段。循环没有固定终点，取消也不顺延，任何分母都是假的。
界面上只显示「已上 N 次」和「已排到 X 日」。

## 3. enrollment 在班关系

```sql
CREATE TABLE enrollment (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES student(id),
  class_id   TEXT NOT NULL REFERENCES klass(id),
  joined_on  TEXT NOT NULL,
  left_on    TEXT,                                -- NULL = 仍在班
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_enrollment_class ON enrollment(class_id, left_on);
CREATE INDEX idx_enrollment_student ON enrollment(student_id, left_on);
```

一个学生可以同时在多个班。移出班级是写 `left_on`，不删行 —— 历史点名记录还要指向他。

## 4. recurrence_rule 循环规则

```sql
CREATE TABLE recurrence_rule (
  id                TEXT PRIMARY KEY,
  class_id          TEXT NOT NULL REFERENCES klass(id),
  weekdays          TEXT NOT NULL,                -- '2,4' ISO：1=周一 … 7=周日
  start_time        TEXT NOT NULL,                -- 'HH:MM'
  end_time          TEXT NOT NULL,
  room              TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  generated_through TEXT,                         -- YYYY-MM-DD，已按此规则生成到哪天（含）
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_rule_class ON recurrence_rule(class_id, active);
```

**规则只是计划。** 它自己不产生任何课，也不参与任何统计。
一个班可以有多条规则（比如寒假临时改成周一三五，可以新建一条规则、停用旧的）。

## 5. session 课次

```sql
CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL REFERENCES klass(id),
  rule_id       TEXT REFERENCES recurrence_rule(id), -- NULL = 临时加课
  date          TEXT NOT NULL,                    -- YYYY-MM-DD
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  room          TEXT,
  kind          TEXT NOT NULL DEFAULT 'regular',  -- regular | extra
  status        TEXT NOT NULL DEFAULT 'planned',  -- planned | taken | cancelled
  cancel_reason TEXT,
  taken_at      INTEGER,                          -- 点名确认的时刻
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (class_id, date, start_time)
);
CREATE INDEX idx_session_date ON session(date);
CREATE INDEX idx_session_class_date ON session(class_id, date);
CREATE INDEX idx_session_status ON session(status, date);
```

`UNIQUE (class_id, date, start_time)` 是幂等生成的关键：重复点「立即生成」不会造出重复课次。

`status` 流转：`planned` →（点名确认）`taken` ／ →（取消）`cancelled`。
`cancelled` 的课次**保留在表里**，课表上画成灰色划线块，取消原因可查。取消不触发任何扣课时。

## 6. attendance 点名记录

```sql
CREATE TABLE attendance (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  student_id TEXT NOT NULL REFERENCES student(id),
  status     TEXT NOT NULL,                       -- present | late | leave | absent
  hours      REAL NOT NULL,                       -- 本次实际扣的课时（规则快照）
  note       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_attendance_student ON attendance(student_id);
```

`hours` 是**写入时按当时规则算好的快照**。之后在设置里改规则，不回溯历史。
出勤率统计只看 `attendance.status`，和扣不扣课时无关。

## 7. package 课包

```sql
CREATE TABLE package (
  id               TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL REFERENCES student(id),
  sessions         INTEGER NOT NULL,              -- 买了几课次
  amount_cents     INTEGER NOT NULL,              -- 总金额（分）
  unit_price_cents INTEGER NOT NULL,              -- ROUND(amount_cents / sessions)，冗余存下
  purchased_on     TEXT NOT NULL,
  method           TEXT,                          -- wechat | alipay | cash | transfer
  offset_sessions  INTEGER NOT NULL DEFAULT 0,    -- 本次充值被抵扣掉的欠课时，仅用于收据展示
  note             TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_package_student ON package(student_id, purchased_on);
```

**没有有效期字段**，这是产品决定，不是遗漏。

`unit_price_cents` 冗余存储，因为它是结转收入的依据，必须锁死在购买那一刻。

`package` 表**不存"还剩几次"**。剩多少由流水推导（见 02 文档的 FIFO 算法）。

## 8. ledger_entry 课时流水 ★

整个系统的核心。余额的唯一真相来源。

```sql
CREATE TABLE ledger_entry (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES student(id),
  occurred_at   INTEGER NOT NULL,                 -- 业务发生时刻（可与 created_at 不同）
  type          TEXT NOT NULL,                    -- consume | recharge | adjust
  delta         REAL NOT NULL,                    -- 课时变动，可正可负可为 0
  balance_after REAL NOT NULL,                    -- 写入时的余额快照（仅用于显示）
  session_id    TEXT REFERENCES session(id),      -- type=consume 时指向课次
  package_id    TEXT REFERENCES package(id),      -- recharge 指向本次课包；consume 指向被扣的包
  amount_cents  INTEGER,                          -- recharge=收款额；consume=结转的课消收入
  reason        TEXT NOT NULL,                    -- 显示在流水「说明」列的文案
  reverses_id   TEXT REFERENCES ledger_entry(id), -- type=adjust 时指向被冲正的分录
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ledger_student ON ledger_entry(student_id, occurred_at DESC);
CREATE INDEX idx_ledger_time ON ledger_entry(occurred_at DESC);
CREATE INDEX idx_ledger_session ON ledger_entry(session_id);
CREATE INDEX idx_ledger_reverses ON ledger_entry(reverses_id);
```

### 账本是 append-only 的

**这张表只 INSERT，永不 UPDATE、永不 DELETE。**

- 点错名了 → 写一条 `adjust`，`delta` 取反，`reverses_id` 指向原分录
- 界面上的「撤销」和「手动调整」是同一个机制的两个入口，区别只在时限和文案（见 02 文档）
- 一条分录被冲正过，等价于 `EXISTS(SELECT 1 FROM ledger_entry WHERE reverses_id = ?)`，显示时加删除线

因为 append-only，`balance_after` 一旦写入就永远正确，不需要重算。

### 每次点名都写一条分录，即使 delta = 0

请假和缺勤扣 0 课时，仍然写 `delta = 0` 的 consume 分录。
理由：家长问"那天我孩子请假了为什么扣钱"，要能在流水里直接翻到那一行写着"请假 · 不扣"。
数据量可忽略（47 人 × 每月 ~9 次课 ≈ 400 行/月）。

## 9. setting 设置

```sql
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                       -- JSON
  updated_at INTEGER NOT NULL
);
```

一个 key 一组设置，value 存 JSON：

```jsonc
// key = 'hours_rule'
{ "present": 1, "late": 1, "leave": 0, "absent": 0,
  "allowNegative": true, "autoOffsetOnRecharge": true,
  "owedPriceMode": "package",      // package | latest
  "undoWindowDays": 7 }

// key = 'alerts'
{ "lowBalanceThreshold": 3, "owedAlertThreshold": 5,
  "dailyDigest": true, "dailyDigestAt": "08:00",
  "scheduleLeadDays": 7, "channels": ["desktop", "badge"] }

// key = 'defaults'
{ "classCapacity": 10, "durationMin": 90, "defaultRoom": "A 教室",
  "rooms": ["A 教室", "B 教室"],
  "paymentMethods": ["wechat", "alipay", "cash", "transfer"],
  "packagePresets": [ { "sessions": 24, "amountCents": 360000 },
                      { "sessions": 12, "amountCents": 192000 },
                      { "sessions": 10, "amountCents": 170000 } ] }

// key = 'org'
{ "name": "", "owner": "", "phone": "", "address": "",
  "logoPath": null, "receiptTitle": "", "receiptFooter": "" }

// key = 'backup'
{ "auto": true, "at": "22:00", "keep": 30 }

// key = 'scheduling'
{ "autoGenerate": true, "leadWeeks": 2, "lastGeneratedAt": null }
```

---

## 不变量（写测试的时候照着来）

1. `balance(student) = SUM(delta) FROM ledger_entry WHERE student_id = ?`
   —— 任何时刻都成立。写完一条分录后，用这个查询和 `balance_after` 对账。
2. 同一个 `(session_id, student_id)` 最多一条 attendance。
3. 同一个 `(class_id, date, start_time)` 最多一条 session。
4. `type = 'consume'` 的分录必须有 `session_id`。
5. `type = 'recharge'` 的分录必须有 `package_id`，且 `delta = package.sessions`。
6. `type = 'adjust'` 的分录 `reverses_id` 可为 NULL（手动调整）或指向一条分录（撤销/冲正）。
7. `package.unit_price_cents = ROUND(amount_cents / sessions)`。
8. `cancelled` 的 session 不得有任何 attendance 或 consume 分录。
9. 未消耗课时 = `SUM(balance) WHERE balance > 0`；欠课时 = `-SUM(balance) WHERE balance < 0`。**两者分开统计，不相加。**
