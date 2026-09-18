/**
 * 与 src-tauri/src/commands/* 一一对应的类型化封装。
 * 所有字段 camelCase；金额单位「分」；课时为 number。
 */
import { invoke } from '@tauri-apps/api/core';

// ---------- 实体 ----------
export interface Student {
  id: string;
  name: string;
  enName: string | null;
  status: 'active' | 'paused' | 'left';
  enrolledOn: string;
  guardianName: string | null;
  phone: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Klass {
  id: string;
  name: string;
  color: string;
  room: string | null;
  capacity: number;
  durationMin: number;
  status: 'active' | 'ended';
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  classId: string;
  ruleId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  room: string | null;
  kind: 'regular' | 'extra';
  status: 'planned' | 'taken' | 'cancelled';
  cancelReason: string | null;
  takenAt: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Package {
  id: string;
  studentId: string;
  sessions: number;
  amountCents: number;
  unitPriceCents: number;
  purchasedOn: string;
  method: string | null;
  offsetSessions: number;
  note: string | null;
  createdAt: number;
}

export type LedgerType = 'consume' | 'recharge' | 'adjust';
export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent';

export interface LedgerEntry {
  id: string;
  studentId: string;
  occurredAt: number;
  type: LedgerType;
  delta: number;
  balanceAfter: number;
  sessionId: string | null;
  packageId: string | null;
  amountCents: number | null;
  reason: string;
  reversesId: string | null;
  createdAt: number;
}

export interface LedgerView extends LedgerEntry {
  studentName: string;
  classId: string | null;
  className: string | null;
  classColor: string | null;
  sessionDate: string | null;
  sessionStart: string | null;
  attendanceStatus: AttendanceStatus | null;
  packageSessions: number | null;
  packageOffset: number | null;
  packageUnitPrice: number | null;
  reversed: boolean;
  undoable: boolean;
}

// ---------- 设置 ----------
export interface HoursRule {
  present: number;
  late: number;
  leave: number;
  absent: number;
  allowNegative: boolean;
  autoOffsetOnRecharge: boolean;
  owedPriceMode: 'package' | 'latest';
  undoWindowDays: number;
}
export interface AlertsSetting {
  lowBalanceThreshold: number;
  owedAlertThreshold: number;
  dailyDigest: boolean;
  dailyDigestAt: string;
  scheduleLeadDays: number;
  channels: string[];
}
export interface PackagePreset { sessions: number; amountCents: number }
export interface DefaultsSetting {
  classCapacity: number;
  durationMin: number;
  defaultRoom: string;
  rooms: string[];
  paymentMethods: string[];
  packagePresets: PackagePreset[];
}
export interface OrgSetting {
  name: string; owner: string; phone: string; address: string;
  logoPath: string | null; receiptTitle: string; receiptFooter: string;
}
export interface BackupSetting { auto: boolean; at: string; keep: number }
export interface SchedulingSetting { autoGenerate: boolean; leadWeeks: number; lastGeneratedAt: number | null }
export interface AllSettings {
  hoursRule: HoursRule;
  alerts: AlertsSetting;
  defaults: DefaultsSetting;
  org: OrgSetting;
  backup: BackupSetting;
  scheduling: SchedulingSetting;
}

export const getSettings = () => invoke<AllSettings>('get_settings');
export const saveSettings = (settingsValue: AllSettings) => invoke<AllSettings>('save_settings', { settingsValue });

// ---------- 学生 ----------
export interface ClassRef { id: string; name: string; color: string }
export interface StudentRow extends Student {
  balance: number;
  classes: ClassRef[];
  monthAttended: number;
  monthTotal: number;
  lastSessionDate: string | null;
  owedCents: number;
  owedUnitPriceCents: number;
  isNewThisMonth: boolean;
}
export interface StudentListStats {
  activeCount: number; owedCount: number; lowCount: number; newCount: number; pausedCount: number; lowBalanceThreshold: number;
}
export interface StudentList { rows: StudentRow[]; stats: StudentListStats }
export type StudentFilter = 'all' | 'owed' | 'low' | 'new' | 'paused' | 'left';

export interface PackageView extends Package { used: number; remaining: number; reversed: boolean }
export interface StudentDetail extends StudentRow {
  totalConsumed: number;
  totalRecharged: number;
  totalPaidCents: number;
  packages: PackageView[];
  ledger: LedgerView[];
  ledgerTotal: number;
  owedText: string;
  undoWindowDays: number;
}
export interface StudentInput {
  name: string;
  enName?: string | null;
  status?: 'active' | 'paused' | 'left';
  enrolledOn?: string | null;
  guardianName?: string | null;
  phone?: string | null;
  note?: string | null;
  classIds?: string[];
}
export interface PickStudent { id: string; name: string; enName: string | null; balance: number; classNames: string }

export const listStudents = (filter?: StudentFilter, query?: string) => invoke<StudentList>('list_students', { filter, query });
export const getStudent = (id: string, page = 0, pageSize = 50) => invoke<StudentDetail>('get_student', { id, page, pageSize });
export const listStudentLedger = (id: string, page: number, pageSize: number) => invoke<LedgerView[]>('list_student_ledger', { id, page, pageSize });
export const createStudent = (input: StudentInput) => invoke<Student>('create_student', { input });
export const updateStudent = (id: string, input: StudentInput) => invoke<Student>('update_student', { id, input });
export const listStudentsForPick = (excludeClassId?: string) => invoke<PickStudent[]>('list_students_for_pick', { excludeClassId });

// ---------- 班级 ----------
export interface RuleSummary {
  id: string; weekdays: number[]; weekdaysText: string; startTime: string; endTime: string;
  room: string | null; active: boolean; generatedThrough: string | null;
}
export interface ClassCard extends Klass {
  rules: RuleSummary[];
  enrolled: number;
  initials: string[];
  takenCount: number;
  generatedThrough: string | null;
  monthSessions: number;
  monthConsumed: number;
  monthRevenueCents: number;
  owedCount: number;
  zeroCount: number;
  nextSessionId: string | null;
}
export interface ClassListStats { classCount: number; enrolled: number; capacity: number; monthSessions: number; monthConsumed: number; monthRevenueCents: number }
export interface ClassList { cards: ClassCard[]; stats: ClassListStats }
export interface RosterRow extends Student {
  enrollmentId: string; joinedOn: string; balance: number; monthAttended: number; monthTotal: number; totalAttended: number; isNewThisMonth: boolean;
}
export interface SessionBrief extends Session {
  presentCount: number; attendanceTotal: number; leaveCount: number; absentCount: number; hoursDeducted: number; isToday: boolean;
}
export interface ClassDetail extends ClassCard {
  roster: RosterRow[];
  recentSessions: SessionBrief[];
  upcomingSessions: SessionBrief[];
  unconsumedHours: number;
  presentCost: number;
}
export interface RuleInput { weekdays: number[]; startTime: string; endTime: string; room?: string | null }
export interface ClassInput { name: string; color: string; room?: string | null; capacity?: number; durationMin?: number; rule?: RuleInput | null; rules?: RuleInput[] | null }
export interface ScheduleResult { createdRules: number; deactivatedRules: number; removedSessions: number; createdSessions: number }

export const listClasses = (includeEnded = false) => invoke<ClassList>('list_classes', { includeEnded });
export const getClass = (id: string) => invoke<ClassDetail>('get_class', { id });
export const createClass = (input: ClassInput) => invoke<Klass>('create_class', { input });
export const updateClass = (id: string, input: ClassInput) => invoke<Klass>('update_class', { id, input });
export const endClass = (id: string) => invoke<void>('end_class', { id });
export const enrollStudent = (classId: string, studentId: string, joinedOn?: string) => invoke<void>('enroll_student', { classId, studentId, joinedOn });
export const unenrollStudent = (enrollmentId: string) => invoke<void>('unenroll_student', { enrollmentId });
/** 整体替换班级上课时间；slots 每条一天一个时段 */
export const setClassSchedule = (classId: string, slots: RuleInput[], applyToFuture: boolean) => invoke<ScheduleResult>('set_class_schedule', { classId, slots, applyToFuture });

// ---------- 排课 ----------
export interface RuleRow extends RuleSummary { classId: string; className: string; classColor: string; perWeek: number }
export interface PreviewRule { ruleId: string; classId: string; className: string; classColor: string; count: number; dates: string[] }
export interface Conflict { date: string; room: string; a: string; b: string; timeA: string; timeB: string }
export interface Holiday { name: string; from: string; to: string; affected: number }
export interface GeneratePreview {
  from: string; to: string; weeks: number; total: number; rules: PreviewRule[]; conflicts: Conflict[]; holidays: Holiday[];
  scheduledThrough: string | null; lastGeneratedAt: number | null; autoGenerate: boolean; leadWeeks: number;
}
export interface GenerateResult { created: number; from: string; to: string }
export interface SessionView extends Session {
  className: string; classColor: string; enrolled: number; ordinal: number; hours: number;
  presentCount: number; attendanceTotal: number; leaveCount: number; absentCount: number; negativeNames: string[]; negativeStudents: { id: string; name: string; after: number }[]; holiday: string | null;
}
export interface WeekView { from: string; to: string; today: string; sessions: SessionView[]; classes: ClassCard[] }
export interface ExtraSessionInput { classId: string; date: string; startTime: string; endTime: string; room?: string | null; note?: string | null }
export interface SessionPatch { date: string; startTime: string; endTime: string; room?: string | null; note?: string | null }
export interface Adjustment extends Session { className: string; classColor: string; kindLabel: 'cancel' | 'extra' }

export const listRules = () => invoke<RuleRow[]>('list_rules');
export const saveRule = (id: string | null, classId: string, input: RuleInput) => invoke<string>('save_rule', { id, classId, input });
export const setRuleActive = (id: string, active: boolean) => invoke<void>('set_rule_active', { id, active });
export const previewGenerate = (weeks: number, from?: string) => invoke<GeneratePreview>('preview_generate', { weeks, from });
export const generateSessions = (weeks: number, from?: string) => invoke<GenerateResult>('generate_sessions', { weeks, from });
export const listSessions = (date?: string) => invoke<WeekView>('list_sessions', { date });
export const cancelSession = (id: string, reason?: string) => invoke<void>('cancel_session', { id, reason });
export const addExtraSession = (input: ExtraSessionInput) => invoke<Session>('add_extra_session', { input });
export const updateSession = (id: string, patch: SessionPatch) => invoke<Session>('update_session', { id, patch });
export const recentAdjustments = () => invoke<Adjustment[]>('recent_adjustments');

// ---------- 点名 ----------
export interface RollcallStudent extends Student {
  balance: number; owedCents: number; attendanceStatus: AttendanceStatus | null; attendanceHours: number | null; extra: boolean;
}
export interface RollcallView {
  session: Session; klass: Klass; ordinal: number; enrolled: number; students: RollcallStudent[];
  rule: HoursRule; ruleSentence: string; owedAlertThreshold: number; lowBalanceThreshold: number;
  undoable: boolean; undoWindowDays: number; hoursDeducted: number;
}
export interface Mark { studentId: string; status: AttendanceStatus }
export interface RollcallResult { totalHours: number; negativeCount: number; owedTotal: number }
export interface AdjustInput { studentId: string; delta: number; reason: string; amountCents?: number | null; occurredOn?: string | null }

export const getRollcall = (sessionId: string) => invoke<RollcallView>('get_rollcall', { sessionId });
export const confirmRollcall = (sessionId: string, marks: Mark[]) => invoke<RollcallResult>('confirm_rollcall', { sessionId, marks });
export const undoRollcall = (sessionId: string) => invoke<void>('undo_rollcall', { sessionId });
export const undoEntry = (entryId: string) => invoke<void>('undo_entry', { entryId });
export const manualAdjust = (input: AdjustInput) => invoke<void>('manual_adjust', { input });

// ---------- 充值 ----------
export type OwedMode = 'offset' | 'cash';
export interface PlannedEntry { entryType: 'recharge' | 'adjust'; delta: number; balanceAfter: number; amountCents: number; reason: string }
export interface RechargePlan { unitPriceCents: number; offsetSessions: number; entries: PlannedEntry[]; receivedCents: number; balanceAfter: number }
export interface RechargeInput {
  studentId: string; sessions: number; amountCents: number; purchasedOn?: string | null; method?: string | null; mode?: OwedMode | null; note?: string | null;
}
export interface RechargePreview { balance: number; owedHours: number; owedUnitPriceCents: number; owedCents: number; autoOffset: boolean; plan: RechargePlan }
export interface RechargeResult { package: Package; plan: RechargePlan }

export const previewRecharge = (input: RechargeInput) => invoke<RechargePreview>('preview_recharge', { input });
export const recharge = (input: RechargeInput) => invoke<RechargeResult>('recharge', { input });

// ---------- 流水 ----------
export type LedgerKind = 'all' | 'consume' | 'recharge' | 'noshow' | 'adjust';
export interface LedgerFilter { month?: string | null; kind?: LedgerKind; classId?: string | null; query?: string | null; page?: number; pageSize?: number }
export interface LedgerSummary {
  rechargeHours: number; rechargeCents: number; rechargeCount: number; consumedHours: number; consumeCents: number;
  adjustHours: number; adjustCount: number; reversalCount: number; unconsumedHours: number; owedHours: number;
}
export interface LedgerPage { rows: LedgerView[]; total: number; summary: LedgerSummary }

export const listLedger = (filter: LedgerFilter) => invoke<LedgerPage>('list_ledger', { filter });
export const exportLedgerCsv = (filter: LedgerFilter) => invoke<string>('export_ledger_csv', { filter });

// ---------- 报表 ----------
export interface MonthPoint { month: string; label: string; consumedHours: number; isCurrent: boolean }
export interface ClassReportRow {
  classId: string; className: string; classColor: string; enrolled: number; capacity: number; sessions: number; consumedHours: number;
  attendanceRate: number | null; avgPriceCents: number; revenueCents: number; unconsumedHours: number;
}
export interface Report {
  month: string; monthLabel: string; sessionsTaken: number; sessionsPlannedTotal: number; consumedHours: number; prevConsumedHours: number;
  consumeRevenueCents: number; rechargeCents: number; rechargeCount: number; rechargeSessions: number;
  attendanceRate: number | null; attendedCount: number; leaveCount: number; absentCount: number;
  series: MonthPoint[]; classes: ClassReportRow[]; totalCapacity: number; totalEnrolled: number;
  unconsumedHours: number; unconsumedValueCents: number; unconsumedStudents: number;
  owedHours: number; owedCents: number; owedStudents: number; isCurrentMonth: boolean; today: string;
}
export const getReport = (month?: string) => invoke<Report>('get_report', { month });
export const exportReportCsv = (month?: string) => invoke<string>('export_report_csv', { month });

// ---------- 今日 / 导航 / 搜索 ----------
export interface AlertStudent { id: string; name: string; balance: number; owedCents: number; className: string | null }
export interface Activity {
  date: string; occurredAt: number; kind: 'rollcall' | 'recharge' | 'adjust' | 'cancel' | 'extra';
  title: string; detail: string; delta: number; sessionId: string | null; studentId: string | null;
}
export interface MonthOverview {
  consumedHours: number; prevConsumedHours: number; revenueCents: number; attendanceRate: number | null; leaveCount: number; activeStudents: number; newStudents: number;
}
export interface TodayView {
  date: string; weekday: string; sessions: SessionView[]; predictedHours: number; alerts: AlertStudent[]; alertCount: number;
  lowBalanceThreshold: number; activities: Activity[]; overview: MonthOverview;
}
export interface NavStats { orgName: string; monthConsumedHours: number; alertCount: number; owedCount: number; todayPending: number }
export interface SearchHit { kind: 'student' | 'class'; id: string; title: string; subtitle: string }

export const getToday = () => invoke<TodayView>('get_today');
export const getNavStats = () => invoke<NavStats>('get_nav_stats');
export const globalSearch = (query: string) => invoke<SearchHit[]>('global_search', { query });

// ---------- 数据 ----------
export interface DataInfo {
  dbPath: string; dbSizeBytes: number; backupDir: string; students: number; classes: number; sessions: number; ledgerEntries: number;
  lastBackupAt: number | null; backupCount: number; backupTotalBytes: number;
}
export interface BackupFile { path: string; name: string; sizeBytes: number; createdAt: number }
export interface InvariantReport { ok: boolean; problems: string[]; studentsChecked: number }

export const getDataInfo = () => invoke<DataInfo>('get_data_info');
export const backupNow = () => invoke<BackupFile>('backup_now');
export const listBackups = () => invoke<BackupFile[]>('list_backups');
export const restoreBackup = (path: string) => invoke<void>('restore_backup', { path });
export const clearAllData = () => invoke<void>('clear_all_data');
export const saveTextFile = (path: string, content: string) => invoke<void>('save_text_file', { path, content });
export const exportDatabase = (path: string) => invoke<void>('export_database', { path });
export const checkInvariants = () => invoke<InvariantReport>('check_invariants');

/** 把 invoke 的错误统一成字符串 */
export function errMsg(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
