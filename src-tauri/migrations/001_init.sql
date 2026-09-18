CREATE TABLE student (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  en_name       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  enrolled_on   TEXT NOT NULL,
  guardian_name TEXT,
  phone         TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_student_status ON student(status);

CREATE TABLE klass (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,
  room         TEXT,
  capacity     INTEGER NOT NULL DEFAULT 10,
  duration_min INTEGER NOT NULL DEFAULT 90,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE enrollment (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES student(id),
  class_id   TEXT NOT NULL REFERENCES klass(id),
  joined_on  TEXT NOT NULL,
  left_on    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_enrollment_class ON enrollment(class_id, left_on);
CREATE INDEX idx_enrollment_student ON enrollment(student_id, left_on);

CREATE TABLE recurrence_rule (
  id                TEXT PRIMARY KEY,
  class_id          TEXT NOT NULL REFERENCES klass(id),
  weekdays          TEXT NOT NULL,
  start_time        TEXT NOT NULL,
  end_time          TEXT NOT NULL,
  room              TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  generated_through TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_rule_class ON recurrence_rule(class_id, active);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL REFERENCES klass(id),
  rule_id       TEXT REFERENCES recurrence_rule(id),
  date          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  room          TEXT,
  kind          TEXT NOT NULL DEFAULT 'regular',
  status        TEXT NOT NULL DEFAULT 'planned',
  cancel_reason TEXT,
  taken_at      INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (class_id, date, start_time)
);
CREATE INDEX idx_session_date ON session(date);
CREATE INDEX idx_session_class_date ON session(class_id, date);
CREATE INDEX idx_session_status ON session(status, date);

CREATE TABLE attendance (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  student_id TEXT NOT NULL REFERENCES student(id),
  status     TEXT NOT NULL,
  hours      REAL NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_attendance_student ON attendance(student_id);

CREATE TABLE package (
  id               TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL REFERENCES student(id),
  sessions         INTEGER NOT NULL,
  amount_cents     INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  purchased_on     TEXT NOT NULL,
  method           TEXT,
  offset_sessions  INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_package_student ON package(student_id, purchased_on);

CREATE TABLE ledger_entry (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES student(id),
  occurred_at   INTEGER NOT NULL,
  type          TEXT NOT NULL,
  delta         REAL NOT NULL,
  balance_after REAL NOT NULL,
  session_id    TEXT REFERENCES session(id),
  package_id    TEXT REFERENCES package(id),
  amount_cents  INTEGER,
  reason        TEXT NOT NULL,
  reverses_id   TEXT REFERENCES ledger_entry(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_ledger_student ON ledger_entry(student_id, occurred_at DESC);
CREATE INDEX idx_ledger_time ON ledger_entry(occurred_at DESC);
CREATE INDEX idx_ledger_session ON ledger_entry(session_id);
CREATE INDEX idx_ledger_reverses ON ledger_entry(reverses_id);

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
