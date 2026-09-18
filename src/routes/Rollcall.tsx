import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import * as api from '../lib/api';
import { errMsg } from '../lib/api';
import type { AttendanceStatus, PickStudent, RollcallStudent, RollcallView } from '../lib/api';
import { Loading, Modal, PageHeader, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';
import { IconInfo } from '../components/icons';
import { cnDate, num, statusLabel, yuan } from '../lib/format';

const STATUSES: AttendanceStatus[] = ['present', 'late', 'leave', 'absent'];
type Marks = Record<string, AttendanceStatus>;
interface Draft { marks: Marks; extras: RollcallStudent[] }

const draftKey = (id: string) => `rollcall-draft:${id}`;
function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return { marks: d.marks ?? {}, extras: Array.isArray(d.extras) ? d.extras : [] };
  } catch { return null; }
}

// 状态按钮样式（照抄画板 script 块）
const BTN: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 30, borderRadius: 7, fontSize: 12.5, cursor: 'pointer' };
const OFF: React.CSSProperties = { ...BTN, border: '1px solid var(--line-ctrl)', background: 'var(--surface)', color: 'var(--ink-3)' };
const ON: Record<AttendanceStatus, React.CSSProperties> = {
  present: { ...BTN, border: '1px solid var(--ok)', background: 'var(--ok)', color: '#FFFFFF' },
  late: { ...BTN, border: '1px solid var(--warn)', background: 'var(--warn)', color: '#FFFFFF' },
  leave: { ...BTN, border: '1px solid var(--leave-line)', background: 'var(--line-mid)', color: '#3A332C' },
  absent: { ...BTN, border: '1px solid var(--danger)', background: 'var(--danger)', color: '#FFFFFF' },
};

/** 从哪进来就回哪：课表 / 班级详情 / 今日 */
export interface BackTo { to: string; label: string }
function useBackTo(): BackTo {
  const loc = useLocation();
  const st = loc.state as { from?: string; label?: string } | null;
  if (st?.from && st.label) return { to: st.from, label: st.label };
  return { to: '/', label: '今日' };
}

export function Rollcall() {
  const { id = '' } = useParams();
  const { data, loading, error, reload } = useAsync(() => api.getRollcall(id), [id]);
  const nav = useNavigate();
  const toast = useToast();
  const back = useBackTo();

  useEffect(() => {
    if (data?.session.status === 'cancelled') {
      toast('这节课已取消，不能点名');
      nav('/schedule', { replace: true });
    }
  }, [data, nav, toast]);

  if (error) return <><PageHeader crumb={back} title="点名" /><div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <><PageHeader crumb={back} title="点名" /><div className="page-body">{loading && <Loading />}</div></>;
  if (data.session.status === 'cancelled') return null;
  return <RollcallBody key={`${id}-${data.session.status}-${data.session.updatedAt}`} view={data} sessionId={id} reload={reload} back={back} />;
}

function RollcallBody({ view, sessionId, reload, back }: { view: RollcallView; sessionId: string; reload: () => void; back: BackTo }) {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();
  const { session, klass, rule } = view;
  const taken = session.status === 'taken';
  const planned = session.status === 'planned';

  // ---------- state ----------
  const [draft] = useState(() => (planned ? loadDraft(sessionId) : null));
  const [marks, setMarks] = useState<Marks>(() => draft?.marks ?? {});
  const [extras, setExtras] = useState<RollcallStudent[]>(() => draft?.extras.filter((e) => !view.students.some((s) => s.id === e.id)) ?? []);
  const [cur, setCur] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(draft ? Date.now() : null);

  const students = useMemo(() => [...view.students, ...extras], [view.students, extras]);
  const statusOf = useCallback((s: RollcallStudent): AttendanceStatus => {
    if (taken) return s.attendanceStatus ?? 'present';
    return marks[s.id] ?? 'present';
  }, [taken, marks]);

  const set = useCallback((studentId: string, st: AttendanceStatus) => {
    if (!planned) return;
    setMarks((m) => ({ ...m, [studentId]: st }));
  }, [planned]);

  // ---------- 计算（翻译自画板 script） ----------
  const rows = useMemo(() => students.map((s) => {
    const st = statusOf(s);
    const free = s.billing === 'free';
    const d = free ? 0 : taken ? (s.attendanceHours ?? 0) : rule[st];
    const after = taken ? s.balance : s.balance - d;
    const afterColor = free ? 'var(--ink-4)' : after < 0 ? 'var(--danger)' : after <= view.lowBalanceThreshold ? 'var(--warn)' : 'var(--ink)';
    const insufficient = planned && !free && !rule.allowNegative && after < 0;
    const note = free
      ? '免费学员 · 记出勤不扣课时'
      : s.balance < 0
        ? <>已欠 <span className="num">{num(-s.balance)}</span> 课时 · 应补 <span className="num">{yuan(s.owedCents)}</span></>
        : (s.note ?? '');
    return { s, st, d, after, afterColor, low: !free && after < 0, insufficient, note, free };
  }), [students, statusOf, taken, rule, planned, view.lowBalanceThreshold]);

  const total = taken ? view.hoursDeducted : rows.reduce((a, r) => a + r.d, 0);
  const low = rows.filter((r) => r.low).length;
  const owed = rows.reduce((a, r) => a + (r.low ? -r.after : 0), 0);
  const insufficientNames = rows.filter((r) => r.insufficient).map((r) => r.s.name);
  const thresholdNames = planned
    ? rows.filter((r) => r.low && -r.after >= view.owedAlertThreshold).map((r) => `${r.s.name}（欠 ${num(-r.after)}）`)
    : [];

  const lowText = low === 0
    ? '所有学生扣后仍有余额'
    : <>{low} 人课时不足，扣后合计欠 <span className="num">{num(owed)}</span> 课时 · {rule.allowNegative ? '不影响上课，补缴后自动抵扣' : '规则不允许欠课时，需先充值'}</>;

  // ---------- 键盘：1/2/3/4 打状态，↑↓ 换行 ----------
  const modalOpen = pickOpen || cancelOpen;
  useEffect(() => {
    if (!planned) return;
    const h = (e: KeyboardEvent) => {
      if (modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(students.length - 1, c + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); return; }
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx >= 0 && students[cur]) { e.preventDefault(); set(students[cur].id, STATUSES[idx]); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [planned, modalOpen, students, cur, set]);

  // ---------- 操作 ----------
  const allPresent = () => { setMarks({}); setErr(null); };

  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey(sessionId), JSON.stringify({ marks, extras } satisfies Draft));
      setDraftSavedAt(Date.now());
      toast('草稿已保存');
    } catch (e) { setErr(errMsg(e)); }
  };

  const doConfirm = async () => {
    setErr(null); setBusy(true);
    try {
      const payload = students.map((s) => ({ studentId: s.id, status: statusOf(s) }));
      const r = await api.confirmRollcall(sessionId, payload);
      try { localStorage.removeItem(draftKey(sessionId)); } catch { /* ignore */ }
      bump();
      toast(`已扣 ${num(r.totalHours)} 课时`, 'ok');
      nav(back.to);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const doCancel = async (reason: string) => {
    setErr(null); setBusy(true);
    try {
      await api.cancelSession(sessionId, reason.trim() || undefined);
      try { localStorage.removeItem(draftKey(sessionId)); } catch { /* ignore */ }
      bump();
      toast('已标记本次不上课');
      setCancelOpen(false);
      nav(back.to);
    } catch (e) { setErr(errMsg(e)); setCancelOpen(false); } finally { setBusy(false); }
  };

  const doUndo = async () => {
    const ok = await confirm({
      title: '撤销本次点名？',
      body: <>将冲正这节课扣掉的 <span className="num">{num(view.hoursDeducted)}</span> 课时，每位学生的余额会恢复。这个操作会写入流水，可以追溯。</>,
      danger: true, confirmText: '撤销点名',
    });
    if (!ok) return;
    setErr(null); setBusy(true);
    try {
      await api.undoRollcall(sessionId);
      bump();
      toast('已撤销本次点名', 'ok');
      reload();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const addExtra = (p: PickStudent) => {
    if (students.some((s) => s.id === p.id)) return;
    const now = Date.now();
    setExtras((xs) => [...xs, {
      id: p.id, name: p.name, enName: p.enName, status: 'active', enrolledOn: '', guardianName: null, phone: null, note: null,
      billing: 'paid' as const, createdAt: now, updatedAt: now, balance: p.balance, owedCents: 0, attendanceStatus: null, attendanceHours: null, extra: true,
    }]);
    setPickOpen(false);
  };
  const removeExtra = (studentId: string) => {
    setExtras((xs) => xs.filter((x) => x.id !== studentId));
    setMarks((m) => { const n = { ...m }; delete n[studentId]; return n; });
  };

  // ---------- render ----------
  return (
    <>
      <PageHeader crumb={back} title={`${klass.name} · 点名`}
        right={planned ? <>
          <button type="button" className="btn" onClick={allPresent}>全部标记出勤</button>
          <button type="button" className="btn" onClick={() => setCancelOpen(true)} disabled={busy}>本次不上课</button>
        </> : undefined} />

      <div className="page-body fixed" style={{ gap: 14 }}>
        {/* 信息条 */}
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '16px 20px', flexShrink: 0 }}>
          <Info label="上课时间" v={<>{cnDate(session.date)} {session.startTime} – {session.endTime}</>} />
          <div className="divider-v" />
          <Info label="课次" v={<>第 {view.ordinal} 次</>} />
          <div className="divider-v" />
          <Info label="在班人数" v={<>{view.enrolled} / {klass.capacity}</>} />
          <div className="divider-v" />
          <Info label="教室" v={session.room ?? klass.room ?? '—'} />
          <div style={{ flexGrow: 1 }} />
          {planned && <button type="button" className="btn md" onClick={() => setPickOpen(true)}>临时加人</button>}
          {taken && <span className="pill ok round" style={{ height: 26, padding: '0 11px', fontSize: 12, borderRadius: 13 }}>已点名</span>}
        </section>

        {/* 规则条 */}
        <section style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--warn-soft)', borderRadius: 10, padding: '10px 16px', flexShrink: 0 }}>
          <IconInfo style={{ color: 'var(--warn-ink)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-on-warn)' }}>扣课时规则：{view.ruleSentence}</span>
          <div style={{ flexGrow: 1 }} />
          <Link to="/settings/rules" style={{ fontSize: 12.5, color: 'var(--warn-ink)', textDecoration: 'underline', whiteSpace: 'nowrap' }}>修改规则</Link>
        </section>

        {/* 名单 */}
        <section className="card" style={{ overflow: 'auto', minHeight: 0, flexShrink: 1 }}>
          <div className="thead" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <span style={{ width: 32, flexShrink: 0 }} />
            <span style={{ flexGrow: 1, minWidth: 0 }}>学生</span>
            <span style={{ width: 246, flexShrink: 0 }}>本次状态</span>
            <span style={{ width: 54, flexShrink: 0, textAlign: 'right' }}>变动</span>
            <span style={{ width: 78, flexShrink: 0, textAlign: 'right' }}>{taken ? '当前余额' : '扣后余额'}</span>
            <span style={{ width: 84, flexShrink: 0, textAlign: 'right' }}>提示</span>
          </div>
          {rows.length === 0 && <div className="empty">这个班还没有在读学生{planned && '，可以「临时加人」'}</div>}
          {rows.map((r, i) => (
            <div key={r.s.id} onMouseEnter={() => setCur(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, height: 52, padding: '0 18px', borderTop: '1px solid var(--line-soft)',
                background: r.low ? 'var(--danger-tint)' : 'var(--surface)',
                boxShadow: planned && i === cur ? 'inset 3px 0 0 var(--accent)' : undefined }}>
              <span className="avatar">{r.s.name.trim().charAt(0)}</span>
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                  {r.s.name}
                  {r.s.enName && <span className="num" style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--ink-3)', marginLeft: 7 }}>{r.s.enName}</span>}
                  {r.s.extra && <span className="pill accent" style={{ marginLeft: 8, height: 18, fontSize: 10.5, padding: '0 6px' }}>临时</span>}
                  {r.s.extra && planned && !view.students.some((s) => s.id === r.s.id) && (
                    <button type="button" onClick={() => removeExtra(r.s.id)} title="移出本次名单"
                      style={{ marginLeft: 6, border: 0, background: 'transparent', color: 'var(--ink-4)', fontSize: 11, cursor: 'pointer', padding: 0 }}>移出</button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.note}</div>
              </div>
              <div style={{ width: 246, flexShrink: 0, display: 'flex', gap: 6 }}>
                {STATUSES.map((st) => (
                  <button key={st} type="button" disabled={!planned} onClick={() => set(r.s.id, st)}
                    style={{ ...(r.st === st ? ON[st] : OFF), ...(taken && r.st !== st ? { opacity: 0.35 } : {}), cursor: planned ? 'pointer' : 'default' }}>
                    {statusLabel(st)}
                  </button>
                ))}
              </div>
              <span style={{ width: 54, flexShrink: 0, textAlign: 'right' }}>
                <span className="num" style={{ fontSize: 14, color: r.d === 0 ? 'var(--ink-3)' : 'var(--accent-deep)' }}>{r.d === 0 ? '0' : '−' + num(r.d)}</span>
              </span>
              <span style={{ width: 78, flexShrink: 0, textAlign: 'right' }}>
                {r.free ? (
                  <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>免费</span>
                ) : (<>
                  {!taken && <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>{num(r.s.balance)} → </span>}
                  <span className="num" style={{ fontSize: 17, fontWeight: 600, color: r.afterColor }}>{num(r.after)}</span>
                </>)}
              </span>
              <span style={{ width: 84, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                {r.insufficient ? (
                  <span className="pill danger round" style={{ fontSize: 11, whiteSpace: 'normal', height: 'auto', padding: '3px 9px', textAlign: 'center', lineHeight: 1.3 }}>余额不足，需先充值</span>
                ) : r.low ? (
                  <span className="pill danger round" style={{ fontSize: 11 }}>欠 <span className="num">{num(-r.after)}</span> 课时</span>
                ) : null}
              </span>
            </div>
          ))}
        </section>

        <div style={{ flexGrow: 1 }} />

        {/* 底栏 */}
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 20px', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>本次共扣</span>
              <span className="num" style={{ fontSize: 27, fontWeight: 600, color: 'var(--accent-deep)', lineHeight: 1 }}>{num(total)}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>课时</span>
            </div>
            {planned && <div style={{ marginTop: 4, fontSize: 12.5, color: low === 0 ? 'var(--ink-3)' : 'var(--danger-ink)' }}>{lowText}</div>}
            {planned && thresholdNames.length > 0 && (
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--warn-ink)' }}>欠课时已达提醒线（{num(view.owedAlertThreshold)} 课时）：{thresholdNames.join('、')}，建议提醒家长补缴</div>
            )}
            {planned && insufficientNames.length > 0 && (
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--danger-ink)' }}>余额不足，需先充值：{insufficientNames.join('、')}</div>
            )}
            {taken && (
              <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--ink-3)' }}>
                {view.undoable
                  ? <>已点名，{num(view.undoWindowDays)} 天内可撤销</>
                  : <>已超过 {num(view.undoWindowDays)} 天，不能撤销；如需更正请到学生详情做手动调整</>}
              </div>
            )}
            {draftSavedAt != null && planned && <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-4)' }}>草稿已保存到本机，未提交</div>}
            {err && <div className="err" style={{ marginTop: 4 }}>{err}</div>}
          </div>
          <div style={{ flexGrow: 1 }} />
          {planned && <>
            <button type="button" className="btn lg" onClick={saveDraft} disabled={busy}>保存草稿</button>
            <button type="button" className="btn lg primary" onClick={doConfirm} disabled={busy || rows.length === 0}>确认扣课时</button>
          </>}
          {taken && (
            <button type="button" className="btn lg danger" onClick={doUndo} disabled={busy || !view.undoable}
              title={view.undoable ? undefined : `超过 ${view.undoWindowDays} 天不能撤销`}>撤销本次点名</button>
          )}
        </section>
      </div>

      {pickOpen && <PickModal classId={klass.id} existing={students.map((s) => s.id)} onPick={addExtra} onClose={() => setPickOpen(false)} />}
      {cancelOpen && <CancelModal busy={busy} onConfirm={doCancel} onClose={() => setCancelOpen(false)} />}
    </>
  );
}

function Info({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  );
}

// ---------- 临时加人 ----------
function PickModal({ classId, existing, onPick, onClose }: { classId: string; existing: string[]; onPick: (p: PickStudent) => void; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.listStudentsForPick(classId), [classId]);
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((p) => !existing.includes(p.id)).filter((p) => {
    const k = q.trim().toLowerCase();
    return !k || p.name.toLowerCase().includes(k) || (p.enName ?? '').toLowerCase().includes(k);
  });
  return (
    <Modal title="临时加人" sub="从不在本班的在读学生里选一位加入本次名单，不改班级名册" onClose={onClose} width={480}
      footer={<button type="button" className="btn" onClick={onClose}>关闭</button>}>
      <input className="input" autoFocus placeholder="搜索姓名 / 英文名" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="err">{error}</div>}
      {loading && !data && <Loading />}
      <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        {data && list.length === 0 && <div className="empty" style={{ padding: 24 }}>没有可加入的学生</div>}
        {list.map((p, i) => (
          <button key={p.id} type="button" onClick={() => onPick(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 48, padding: '0 14px', border: 0, borderTop: i ? '1px solid var(--line-soft)' : 0, background: 'var(--surface)', textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunk)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}>
            <span className="avatar" style={{ width: 28, height: 28, fontSize: 12.5 }}>{p.name.trim().charAt(0)}</span>
            <span style={{ flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
              {p.enName && <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginLeft: 7 }}>{p.enName}</span>}
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{p.classNames || '未在班'}</span>
            </span>
            <span className="num" style={{ fontSize: 15, fontWeight: 600, color: p.balance < 0 ? 'var(--danger)' : p.balance <= 0 ? 'var(--warn)' : 'var(--ink)' }}>{num(p.balance)}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>课时</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------- 本次不上课 ----------
function CancelModal({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="本次不上课？" sub="这节课会标记为取消，不扣任何课时；今日与课表里不再显示为待点名" onClose={onClose} width={440}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button type="button" className="btn danger" autoFocus disabled={busy} onClick={() => onConfirm(reason)}>确认不上课</button>
      </>}>
      <div className="field">
        <label>原因（可选）</label>
        <input className="input" placeholder="如：老师请假、场地维修" value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(reason); }} />
      </div>
    </Modal>
  );
}
