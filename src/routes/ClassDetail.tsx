import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import * as api from '../lib/api';
import type { ClassDetail as ClassDetailView, PickStudent, RosterRow, SessionBrief } from '../lib/api';
import { Empty, Loading, Modal, PageHeader, balanceColor, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';
import { IconCheck, IconSearch } from '../components/icons';
import { ClassFormModal } from '../components/ClassFormModal';
import { saveCsv } from '../lib/files';
import { md, num, todayStr, yuan } from '../lib/format';
import { ruleText } from './Classes';

const LABEL: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)' };
const STAT: React.CSSProperties = { fontSize: 18, fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap' };
const COL = { join: 88, bal: 68, att: 70, total: 70, op: 60 };

export function ClassDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => Promise.all([api.getClass(id), api.getSettings()]).then(([k, s]) => ({ k, threshold: s.alerts.lowBalanceThreshold })),
    [id],
  );

  const crumb = { to: '/classes', label: '班级' };
  if (error) return <><PageHeader crumb={crumb} title="班级详情" /><div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <><PageHeader crumb={crumb} title="班级详情" /><div className="page-body">{loading && <Loading />}</div></>;

  const k: ClassDetailView = data.k;
  const threshold = data.threshold;
  const active = k.status === 'active';
  const activeRules = k.rules.filter((r) => r.active);
  const mainRule = activeRules[0] ?? k.rules[0];
  const rollTo = k.nextSessionId ? `/sessions/${k.nextSessionId}/roll-call` : null;

  const sessions = mergeSessions(k.recentSessions, k.upcomingSessions);

  const afterWrite = (msg: string) => { reload(); bump(); toast(msg, 'ok'); };

  const removeStudent = async (r: RosterRow) => {
    const ok = await confirm({
      title: `把 ${r.name} 移出 ${k.name}？`,
      body: '只结束在班关系，不删除学生资料和课时流水。之后可以再加回来。',
      danger: true, confirmText: '移出班级',
    });
    if (!ok) return;
    setOpErr(null);
    try {
      await api.unenrollStudent(r.enrollmentId);
      afterWrite(`已将 ${r.name} 移出班级`);
    } catch (e) { setOpErr(api.errMsg(e)); }
  };

  const endClass = async () => {
    const ok = await confirm({
      title: `结束 ${k.name}？`,
      body: <>班级会标记为已结束，不再出现在在读列表里；已生成的课次、名册和流水都保留。班里还有 <span className="num">{k.enrolled}</span> 名学生。</>,
      danger: true, confirmText: '结束班级',
    });
    if (!ok) return;
    setOpErr(null);
    try {
      await api.endClass(k.id);
      bump(); toast('班级已结束', 'ok');
      nav('/classes');
    } catch (e) { setOpErr(api.errMsg(e)); }
  };

  const exportRoster = async () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [['学生', '英文名', '入班日期', '课时余额', '本月出勤', '本月课次', '累计上课'].join(',')];
    for (const r of k.roster) lines.push([r.name, r.enName ?? '', r.joinedOn, String(r.balance), String(r.monthAttended), String(r.monthTotal), String(r.totalAttended)].map(esc).join(','));
    try {
      const saved = await saveCsv(`${k.name}-名册.csv`, '\uFEFF' + lines.join('\n'));
      if (saved) toast('名册已导出', 'ok');
    } catch (e) { setOpErr(api.errMsg(e)); }
  };

  const title = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: k.color, flexShrink: 0 }} />
      {k.name}
      {!active && <span className="pill neutral" style={{ fontFamily: 'var(--font-body)', fontWeight: 400 }}>已结束</span>}
    </span>
  );

  return (
    <>
      <PageHeader crumb={crumb} title={title} right={<>
        <button className="btn" onClick={() => setEditing(true)}>编辑班级</button>
        <button className="btn" disabled={!active} onClick={() => setEnrolling(true)}>加入学生</button>
        {rollTo ? <Link className="btn primary" to={rollTo} state={{ from: `/classes/${id}`, label: k.name }}>去点名</Link> : <button className="btn primary" disabled title="没有待点名的课次">去点名</button>}
      </>} />

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '16px 20px', flexWrap: 'wrap', rowGap: 12, whiteSpace: 'nowrap' }}>
          <div>
            <div style={LABEL}>上课时间</div>
            <div className="num" style={STAT}>{activeRules.length === 0 ? <span className="faint">未设置</span> : activeRules.map((r, i) => (
              <span key={r.id}>{i > 0 && <span style={{ color: 'var(--ink-4)', margin: '0 8px' }}>·</span>}{ruleText(r, null)}</span>
            ))}</div>
          </div>
          <div className="divider-v" />
          <div>
            <div style={LABEL}>已上课次</div>
            <div className="num" style={STAT}>{k.takenCount} 次 · {k.generatedThrough ? <>已排到 {md(k.generatedThrough)}</> : '尚未排课'}</div>
          </div>
          <div className="divider-v" />
          <div>
            <div style={LABEL}>在班人数</div>
            <div className="num" style={STAT}>{k.enrolled} / {k.capacity}</div>
          </div>
          <div className="divider-v" />
          <div>
            <div style={LABEL}>本月课消</div>
            <div className="num" style={STAT}>{num(k.monthConsumed)} 课时 · {yuan(k.monthRevenueCents)}</div>
          </div>
          <div className="divider-v" />
          <div>
            <div style={LABEL}>班内未消耗</div>
            <div className="num" style={STAT}>{num(k.unconsumedHours)} 课时</div>
          </div>
          <div style={{ flexGrow: 1 }} />
          {k.owedCount > 0 && <span className="pill danger round" style={{ height: 28, padding: '0 12px', fontSize: 12, borderRadius: 14 }}><span className="num">{k.owedCount}</span> 人欠课时</span>}
        </section>

        {opErr && <div className="err">{opErr}</div>}

        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 20px', borderBottom: '1px solid var(--line-faint)' }}>
              <h2 style={{ fontSize: 16 }}>班级名册</h2>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}><span className="num">{k.enrolled}</span> 人 · 上限 <span className="num">{k.capacity}</span> 人</span>
              <div style={{ flexGrow: 1 }} />
              <button className="btn sm" disabled={k.roster.length === 0} onClick={exportRoster}>导出名册</button>
            </div>
            {k.roster.length === 0 ? (
              <Empty title="班里还没有学生" hint="把学生加进来后，排课和点名都会带上他们"
                action={active ? <button className="btn primary sm" style={{ marginTop: 6 }} onClick={() => setEnrolling(true)}>加入学生</button> : undefined} />
            ) : (
              <>
                <div className="thead" style={{ height: 36, padding: '0 20px' }}>
                  <span style={{ flexGrow: 1, minWidth: 0 }}>学生</span>
                  <span className="right" style={{ width: COL.join, flexShrink: 0 }}>入班日期</span>
                  <span className="right" style={{ width: COL.bal, flexShrink: 0 }}>课时余额</span>
                  <span className="right" style={{ width: COL.att, flexShrink: 0 }}>本月出勤</span>
                  <span className="right" style={{ width: COL.total, flexShrink: 0 }}>累计上课</span>
                  <span className="right" style={{ width: COL.op, flexShrink: 0 }}>操作</span>
                </div>
                {k.roster.map((r) => (
                  <RosterLine key={r.enrollmentId} r={r} threshold={threshold} onOpen={() => nav(`/students/${r.id}`)} onRemove={() => removeStudent(r)} />
                ))}
              </>
            )}
          </section>

          <aside style={{ width: 340, flexShrink: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', height: 52, padding: '0 18px', borderBottom: '1px solid var(--line-faint)' }}>
                <h2 style={{ fontSize: 16 }}>最近课次</h2>
                <div style={{ flexGrow: 1 }} />
                <Link to="/ledger" style={{ fontSize: 12 }}>全部流水</Link>
              </div>
              {sessions.length === 0 ? (
                <div className="muted" style={{ fontSize: 12.5, padding: '16px 18px' }}>还没有课次，去「排课」按规则生成</div>
              ) : sessions.map((s, i) => <SessionLine key={s.id} s={s} first={i === 0} onOpen={() => nav(`/sessions/${s.id}/roll-call`, { state: { from: `/classes/${id}`, label: k.name } })} />)}
            </section>

            <section className="card" style={{ padding: '16px 18px' }}>
              <h2 style={{ fontSize: 15 }}>班级设置</h2>
              <Row l="人数上限"><span style={{ color: 'var(--ink)' }}><span className="num">{k.capacity}</span> 人</span></Row>
              <Row l="循环规则">
                {mainRule
                  ? <Link to="/schedule/planning">{activeRules.length > 1 ? activeRules.map((r) => `${r.weekdaysText} ${r.startTime}`).join(' · ') : <>{mainRule.weekdaysText} <span className="num">{mainRule.startTime}</span></>}</Link>
                  : <Link to="/schedule/planning">去设置</Link>}
              </Row>
              <Row l="每次扣课时"><span style={{ color: 'var(--ink)' }}><span className="num">{num(k.presentCost)}</span> 课时 / 人</span></Row>
              <Row l="扣课时规则"><Link to="/settings/rules">跟随全局设置</Link></Row>
            </section>

            {active && (
              <button className="btn ghost" onClick={endClass} style={{ alignSelf: 'flex-start', color: 'var(--danger-ink)', fontSize: 12.5, padding: '0 8px' }}>结束班级</button>
            )}
          </aside>
        </div>
      </div>

      {editing && <ClassFormModal klass={k} rules={k.rules} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
      {enrolling && <EnrollModal classId={k.id} className={k.name} onClose={() => setEnrolling(false)} onDone={(n) => { setEnrolling(false); afterWrite(`已加入 ${n} 名学生`); }} />}
    </>
  );
}

function Row({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
      <span>{l}</span>{children}
    </div>
  );
}

// ---------- 名册行 ----------
function RosterLine({ r, threshold, onOpen, onRemove }: { r: RosterRow; threshold: number; onOpen: () => void; onRemove: () => void }) {
  const owed = r.balance < 0;
  const tone = owed ? 'danger' : r.balance <= threshold ? 'warn' : undefined;
  return (
    <div className={`trow clickable ${owed ? 'danger' : ''}`} style={{ minHeight: 46, padding: '0 20px' }} onClick={onOpen}>
      <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
        <span className={`avatar ${tone ?? ''}`} style={{ width: 27, height: 27, fontSize: 12 }}>{r.name.trim().charAt(0)}</span>
        <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</span>
        {r.enName && <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{r.enName}</span>}
        {r.isNewThisMonth && <span className="pill ok" style={{ height: 19, padding: '0 7px', borderRadius: 5, fontSize: 10.5, flexShrink: 0 }}>本月新增</span>}
      </span>
      <span className="num right" style={{ width: COL.join, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>{r.joinedOn}</span>
      <span className="num right" style={{ width: COL.bal, flexShrink: 0, fontSize: 16, fontWeight: 600, color: balanceColor(r.balance, threshold) }}>{num(r.balance)}</span>
      <span className="num right" style={{ width: COL.att, flexShrink: 0, fontSize: 13, color: 'var(--ink-2)' }}>{r.monthAttended} / {r.monthTotal}</span>
      <span className="num right" style={{ width: COL.total, flexShrink: 0, fontSize: 13, color: 'var(--ink-2)' }}>{r.totalAttended}</span>
      <span className="right" style={{ width: COL.op, flexShrink: 0 }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}>移出班级</button>
      </span>
    </div>
  );
}

// ---------- 课次行 ----------
function mergeSessions(recent: SessionBrief[], upcoming: SessionBrief[]): SessionBrief[] {
  const byId = new Map<string, SessionBrief>();
  for (const s of [...recent, ...upcoming]) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => (a.date === b.date ? b.startTime.localeCompare(a.startTime) : b.date.localeCompare(a.date)));
}

function SessionLine({ s, first, onOpen }: { s: SessionBrief; first: boolean; onOpen: () => void }) {
  const base: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, height: 50, padding: '0 18px', borderTop: first ? 0 : '1px solid var(--line-soft)', cursor: 'pointer' };
  const pendingToday = s.isToday && s.status === 'planned';
  if (pendingToday) {
    return (
      <div style={{ ...base, background: 'var(--accent-tint)' }} onClick={onOpen}>
        <span className="num" style={{ width: 46, flexShrink: 0, fontSize: 13, fontWeight: 600, color: 'var(--accent-deep)' }}>{md(s.date)}</span>
        <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: 'var(--accent-deep)' }}>今天 <span className="num">{s.startTime}</span> · 待点名</span>
        <Link to={`/sessions/${s.id}/roll-call`} state={{ from: `/classes/${s.classId}`, label: '班级' }} onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 11px', borderRadius: 13, background: 'var(--accent)', color: 'var(--nav-text-on)', fontSize: 12 }}>点名</Link>
      </div>
    );
  }
  if (s.status === 'cancelled') {
    return (
      <div style={base} onClick={onOpen}>
        <span className="num strike" style={{ width: 46, flexShrink: 0, fontSize: 13 }}>{md(s.date)}</span>
        <span className="strike" style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5 }}>已取消{s.cancelReason ? ` · ${s.cancelReason}` : ''}</span>
      </div>
    );
  }
  if (s.status === 'taken') {
    const extra = s.leaveCount > 0 || s.absentCount > 0
      ? [s.leaveCount > 0 ? `${s.leaveCount} 人请假` : null, s.absentCount > 0 ? `${s.absentCount} 人缺勤` : null].filter(Boolean).join('、')
      : '全勤';
    return (
      <div style={base} onClick={onOpen}>
        <span className="num" style={{ width: 46, flexShrink: 0, fontSize: 13, color: 'var(--ink-2)' }}>{md(s.date)}</span>
        <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>出勤 <span className="num">{s.presentCount} / {s.attendanceTotal}</span> · {extra}</span>
        <span className="num" style={{ fontSize: 13.5, color: 'var(--accent-deep)' }}>{num(-s.hoursDeducted)}</span>
      </div>
    );
  }
  // 未来 / 过去未点名
  const past = !s.isToday && s.date < todayStr();
  return (
    <div style={base} onClick={onOpen}>
      <span className="num" style={{ width: 46, flexShrink: 0, fontSize: 13, color: 'var(--ink-3)' }}>{md(s.date)}</span>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: past ? 'var(--warn-ink)' : 'var(--ink-3)' }}><span className="num">{s.startTime}</span> · {past ? '未点名' : '未开始'}</span>
    </div>
  );
}

// ---------- 加入学生 ----------
function EnrollModal({ classId, className, onClose, onDone }: { classId: string; className: string; onClose: () => void; onDone: (n: number) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useAsync(() => api.listStudentsForPick(classId), [classId]);

  const list = useMemo(() => {
    const all: PickStudent[] = data ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((p) => p.name.toLowerCase().includes(s) || (p.enName ?? '').toLowerCase().includes(s));
  }, [data, q]);

  const toggle = (id: string) => setPicked((set) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = async () => {
    if (picked.size === 0) { setErr('先勾选要加入的学生'); return; }
    setBusy(true); setErr(null);
    let done = 0;
    const failed: string[] = [];
    for (const p of (data ?? []).filter((x) => picked.has(x.id))) {
      try { await api.enrollStudent(classId, p.id); done += 1; }
      catch (e) { failed.push(`${p.name}：${api.errMsg(e)}`); }
    }
    setBusy(false);
    if (failed.length > 0) { setErr(failed.join('；')); if (done > 0) setPicked(new Set()); return; }
    onDone(done);
  };

  return (
    <Modal title="加入学生" sub={<>加入 {className} · 只列出在读且尚未在本班的学生</>} onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy || picked.size === 0} onClick={submit}>加入{picked.size > 0 && <> <span className="num">{picked.size}</span> 人</>}</button>
      </>}>
      <div className="search-box">
        <IconSearch style={{ color: 'var(--ink-4)' }} />
        <input autoFocus value={q} placeholder="搜索姓名 / 英文名" style={{ width: '100%' }} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'auto', maxHeight: 340 }}>
        {error && <div className="err" style={{ padding: 12 }}>{error}</div>}
        {!data && loading && <Loading />}
        {data && list.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '18px 14px', textAlign: 'center' }}>{q ? '没有匹配的学生' : '没有可加入的学生'}</div>}
        {list.map((p, i) => {
          const on = picked.has(p.id);
          return (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 12px', borderTop: i === 0 ? 0 : '1px solid var(--line-soft)', cursor: 'pointer', background: on ? 'var(--accent-tint)' : undefined }}>
              <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`, background: on ? 'var(--accent)' : '#fff', color: 'var(--nav-text-on)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on && <IconCheck size={11} />}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
              {p.enName && <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.enName}</span>}
              <span style={{ flexGrow: 1, minWidth: 0, fontSize: 11.5, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{p.classNames}</span>
              <span className="num" style={{ width: 40, textAlign: 'right', fontSize: 13, fontWeight: 600, color: balanceColor(p.balance) }}>{num(p.balance)}</span>
            </label>
          );
        })}
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
