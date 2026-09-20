/**
 * 把 Tauri 的 invoke 换成内存假数据：冒烟测试只关心「界面能不能渲染出来」，
 * 所以每个命令返回一份形状正确的最小数据。新增命令时在这里补一条即可。
 */
const today = new Date();
const p = (n: number) => String(n).padStart(2, '0');
export const TODAY = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
export const MONTH = TODAY.slice(0, 7);

const klass = {
  id: 'k1', name: 'Movers B 班', color: '#4C6F55', room: 'A 教室', capacity: 10, durationMin: 90,
  status: 'active', createdAt: 1, updatedAt: 1,
};
const rule = {
  id: 'r1', weekdays: [2, 4], weekdaysText: '周二 / 周四', startTime: '14:00', endTime: '15:30',
  room: 'A 教室', active: true, generatedThrough: TODAY,
};
const classCard = {
  ...klass, rules: [rule], enrolled: 2, initials: ['林', '陈'], takenCount: 3, generatedThrough: TODAY,
  monthSessions: 4, monthConsumed: 7, monthRevenueCents: 105000, owedCount: 1, zeroCount: 0, nextSessionId: 's1',
};
const student = {
  id: 'st1', name: '林小满', enName: 'Lily' as string | null, status: 'active', enrolledOn: '2026-03-05',
  guardianName: null, phone: null, note: null, billing: 'paid', createdAt: 1, updatedAt: 1,
};
const freeStudent = { ...student, id: 'st2', name: '小朋友', enName: null, billing: 'free' };
const studentRow = (s: typeof student) => ({
  ...s, balance: s.billing === 'free' ? 0 : -2, classes: [{ id: 'k1', name: klass.name, color: klass.color }],
  monthAttended: 4, monthTotal: 5, lastSessionDate: TODAY, owedCents: 30000, owedUnitPriceCents: 15000, isNewThisMonth: false,
});
const session = {
  id: 's1', classId: 'k1', ruleId: 'r1', date: TODAY, startTime: '14:00', endTime: '15:30', room: 'A 教室',
  kind: 'regular', status: 'planned', cancelReason: null, takenAt: null, note: null, createdAt: 1, updatedAt: 1,
};
const sessionView = {
  ...session, className: klass.name, classColor: klass.color, enrolled: 2, ordinal: 4, hours: 2,
  presentCount: 0, attendanceTotal: 0, leaveCount: 0, absentCount: 0,
  negativeNames: ['林小满'], negativeStudents: [{ id: 'st1', name: '林小满', after: -3 }], holiday: null,
};
const ledgerRow = {
  id: 'l1', studentId: 'st1', occurredAt: Date.now(), type: 'consume', delta: -1, balanceAfter: -2,
  sessionId: 's1', packageId: 'p1', amountCents: 15000, reason: '出勤', reversesId: null, createdAt: 1,
  studentName: '林小满', classId: 'k1', className: klass.name, classColor: klass.color,
  sessionDate: TODAY, sessionStart: '14:00', attendanceStatus: 'present',
  packageSessions: 10, packageOffset: 0, packageUnitPrice: 15000, reversed: false, undoable: true,
};
const settings = {
  hoursRule: { present: 1, late: 1, leave: 0, absent: 0, allowNegative: true, autoOffsetOnRecharge: true, owedPriceMode: 'package', undoWindowDays: 7 },
  alerts: { lowBalanceThreshold: 3, owedAlertThreshold: 3, dailyDigest: true, dailyDigestAt: '10:00', scheduleLeadDays: 7, channels: ['desktop'] },
  defaults: { classCapacity: 10, durationMin: 90, defaultRoom: 'A 教室', rooms: ['A 教室'], paymentMethods: ['wechat', 'cash'], packagePresets: [{ sessions: 24, amountCents: 360000 }] },
  org: { name: '测试机构', owner: '', phone: '', address: '', logoPath: null, receiptTitle: '', receiptFooter: '' },
  backup: { auto: true, at: '22:00', keep: 30 },
  scheduling: { autoGenerate: true, leadWeeks: 1, lastGeneratedAt: Date.now() },
};
const pkg = {
  id: 'p1', studentId: 'st1', sessions: 10, amountCents: 150000, unitPriceCents: 15000,
  purchasedOn: '2026-07-02', method: 'wechat', offsetSessions: 0, note: null, createdAt: 1,
};

export const RESPONSES: Record<string, unknown> = {
  get_settings: settings,
  save_settings: settings,
  list_students: { rows: [studentRow(student), studentRow(freeStudent)], stats: { activeCount: 2, owedCount: 1, lowCount: 0, newCount: 0, pausedCount: 0, lowBalanceThreshold: 3 } },
  get_student: {
    ...studentRow(student), totalConsumed: 12, totalRecharged: 10, totalPaidCents: 150000,
    packages: [{ ...pkg, used: 12, remaining: -2, reversed: false }],
    ledger: [ledgerRow], ledgerTotal: 1, owedText: '已欠 2 课时 · 应补 ¥300', undoWindowDays: 7,
  },
  list_student_ledger: [ledgerRow],
  create_student: student,
  update_student: student,
  list_students_for_pick: [{ id: 'st3', name: '新同学', enName: null, balance: 0, classNames: '' }],
  list_classes: { cards: [classCard], stats: { classCount: 1, enrolled: 2, capacity: 10, monthSessions: 4, monthConsumed: 7, monthRevenueCents: 105000 } },
  get_class: {
    ...classCard,
    roster: [{ ...student, enrollmentId: 'e1', joinedOn: '2026-03-05', balance: -2, monthAttended: 4, monthTotal: 5, totalAttended: 20, isNewThisMonth: false }],
    recentSessions: [{ ...session, presentCount: 2, attendanceTotal: 2, leaveCount: 0, absentCount: 0, hoursDeducted: 2, isToday: true }],
    upcomingSessions: [], unconsumedHours: 12, presentCost: 1,
  },
  create_class: klass,
  update_class: klass,
  end_class: null,
  enroll_student: null,
  unenroll_student: null,
  set_class_schedule: { createdRules: 1, deactivatedRules: 0, removedSessions: 0, createdSessions: 2 },
  list_rules: [{ ...rule, classId: 'k1', className: klass.name, classColor: klass.color, perWeek: 2 }],
  save_rule: 'r1',
  set_rule_active: null,
  preview_generate: {
    from: TODAY, to: TODAY, weeks: 1, total: 2,
    rules: [{ ruleId: 'r1', classId: 'k1', className: klass.name, classColor: klass.color, count: 2, dates: [TODAY] }],
    conflicts: [], holidays: [], scheduledThrough: TODAY, lastGeneratedAt: Date.now(), autoGenerate: true, leadWeeks: 1,
  },
  generate_sessions: { created: 2, from: TODAY, to: TODAY },
  list_sessions: { from: TODAY, to: TODAY, today: TODAY, sessions: [sessionView], classes: [classCard] },
  cancel_session: null,
  delete_session: null,
  add_extra_session: session,
  update_session: session,
  recent_adjustments: [{ ...session, className: klass.name, classColor: klass.color, kindLabel: 'extra' }],
  get_rollcall: {
    session, klass, ordinal: 4, enrolled: 2,
    students: [
      { ...student, balance: -2, owedCents: 30000, attendanceStatus: null, attendanceHours: null, extra: false },
      { ...freeStudent, balance: 0, owedCents: 0, attendanceStatus: null, attendanceHours: null, extra: false },
    ],
    rule: settings.hoursRule, ruleSentence: '扣课时规则：出勤扣 1 课时。', owedAlertThreshold: 3,
    lowBalanceThreshold: 3, undoable: false, undoWindowDays: 7, hoursDeducted: 0,
  },
  confirm_rollcall: { totalHours: 2, negativeCount: 1, owedTotal: 3 },
  undo_rollcall: null,
  undo_entry: null,
  manual_adjust: null,
  preview_recharge: {
    balance: -2, owedHours: 2, owedUnitPriceCents: 15000, owedCents: 30000, autoOffset: true,
    plan: { unitPriceCents: 15000, offsetSessions: 2, entries: [{ entryType: 'recharge', delta: 10, balanceAfter: 8, amountCents: 150000, reason: '课包 10 课次' }], receivedCents: 150000, balanceAfter: 8 },
  },
  recharge: { package: pkg, plan: { unitPriceCents: 15000, offsetSessions: 2, entries: [], receivedCents: 150000, balanceAfter: 8 } },
  list_ledger: {
    rows: [ledgerRow], total: 1,
    summary: { rechargeHours: 10, rechargeCents: 150000, rechargeCount: 1, consumedHours: 7, consumeCents: 105000, adjustHours: 0, adjustCount: 0, reversalCount: 0, unconsumedHours: 12, owedHours: 2 },
  },
  export_ledger_csv: 'a,b\n1,2\n',
  get_report: {
    month: MONTH, monthLabel: '测试月', sessionsTaken: 4, sessionsPlannedTotal: 6, consumedHours: 7, prevConsumedHours: 5,
    consumeRevenueCents: 105000, rechargeCents: 150000, rechargeCount: 1, rechargeSessions: 10,
    attendanceRate: 0.95, attendedCount: 19, leaveCount: 1, absentCount: 0,
    series: [{ month: MONTH, label: '本月', consumedHours: 7, isCurrent: true }],
    classes: [{ classId: 'k1', className: klass.name, classColor: klass.color, enrolled: 2, capacity: 10, sessions: 4, consumedHours: 7, attendanceRate: 0.95, avgPriceCents: 15000, revenueCents: 105000, unconsumedHours: 12 }],
    totalCapacity: 10, totalEnrolled: 2, unconsumedHours: 12, unconsumedValueCents: 180000, unconsumedStudents: 1,
    owedHours: 2, owedCents: 30000, owedStudents: 1, isCurrentMonth: true, today: TODAY,
  },
  export_report_csv: 'a,b\n1,2\n',
  get_today: {
    date: TODAY, weekday: '星期五', sessions: [sessionView], predictedHours: 2,
    alerts: [{ id: 'st1', name: '林小满', balance: -2, owedCents: 30000, className: klass.name }],
    alertCount: 1, lowBalanceThreshold: 3,
    activities: [{ date: TODAY.slice(5), occurredAt: Date.now(), kind: 'rollcall', title: '点名完成', detail: '全勤', delta: -2, sessionId: 's1', studentId: null }],
    overview: { consumedHours: 7, prevConsumedHours: 5, revenueCents: 105000, attendanceRate: 0.95, leaveCount: 1, activeStudents: 2, newStudents: 0 },
  },
  get_nav_stats: { orgName: '测试机构', monthConsumedHours: 7, alertCount: 1, owedCount: 1, todayPending: 1 },
  global_search: [],
  get_data_info: {
    dbPath: '/tmp/data.db', dbSizeBytes: 1024, backupDir: '/tmp/backups', students: 2, classes: 1, sessions: 4,
    ledgerEntries: 9, lastBackupAt: Date.now(), backupCount: 1, backupTotalBytes: 2048,
  },
  backup_now: { path: '/tmp/b.db', name: 'b.db', sizeBytes: 1024, createdAt: Date.now() },
  list_backups: [{ path: '/tmp/b.db', name: 'b.db', sizeBytes: 1024, createdAt: Date.now() }],
  restore_backup: null,
  clear_all_data: null,
  save_text_file: null,
  export_database: null,
  check_invariants: { ok: true, problems: [], studentsChecked: 2 },
  get_app_version: '0.0.0-test',
  check_update: {
    current: '0.0.0-test', latest: '0.0.0-test', available: false, notes: '', publishedAt: null,
    pageUrl: 'https://example.com', asset: null, checkedAt: Date.now(), canInstall: false,
  },
  install_update: null,
  authenticate: { ok: true, unavailable: false, message: '' },
};

export const invoked: string[] = [];
/** 每次调用的命令与参数，交互测试用来断言「真的把对的数据发给了后端」 */
export const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const overrides: Record<string, unknown> = {};

export function setResponse(cmd: string, value: unknown) { overrides[cmd] = value; }
export function resetCalls() { invoked.length = 0; calls.length = 0; for (const k of Object.keys(overrides)) delete overrides[k]; }
export function lastCall(cmd: string) { return [...calls].reverse().find((c) => c.cmd === cmd); }

/** 没登记过的命令直接失败，提醒补 fixture，而不是悄悄返回 undefined */
export function fakeInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  invoked.push(cmd);
  calls.push({ cmd, args: args ?? {} });
  if (cmd in overrides) return Promise.resolve(overrides[cmd]);
  if (!(cmd in RESPONSES)) {
    return Promise.reject(new Error(`测试里没有为命令 ${cmd} 准备假数据，请在 src/test/tauri-mock.ts 里补上`));
  }
  return Promise.resolve(RESPONSES[cmd]);
}
