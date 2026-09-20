import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as api from '../lib/api';
import type { Activity, AlertStudent, SearchHit, SessionView, TodayView } from '../lib/api';
import { Empty, Loading, PageHeader, useAsync } from '../components/ui';
import { IconCheck, IconSearch } from '../components/icons';
import { cnDate, num, pct, weekdayCn, yuan } from '../lib/format';

const H2: React.CSSProperties = { fontSize: 17 };

export function Today() {
  const { data, loading, error } = useAsync(() => api.getToday(), []);

  if (error) return <><PageHeader title="今日" /><div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <><PageHeader title="今日" /><div className="page-body">{loading && <Loading />}</div></>;

  const v: TodayView = data;
  const sessions = v.sessions;
  const firstPendingId = sessions.find((s) => s.status === 'planned')?.id ?? null;
  const sub = `${cnDate(v.date)} · ${v.weekday || weekdayCn(v.date)} · ${sessions.length} 节课 · 预计课消 ${num(v.predictedHours)} 课时`;

  return (
    <>
      <PageHeader title="今日" sub={sub} right={<><SearchBox /><Link className="btn primary" to="/students">登记充值</Link></>} />
      <div className="page-body" style={{ padding: '22px 32px 28px', display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <section style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={H2}>今日课程</h2>
            <Link to="/schedule" style={{ fontSize: 12.5 }}>查看本周课表</Link>
          </div>

          {sessions.length === 0 ? (
            <div className="card">
              <Empty title="今天没有排课" action={<Link to="/schedule" style={{ fontSize: 12.5 }}>去课表看看这周</Link>} />
            </div>
          ) : (
            sessions.map((s) => <SessionCard key={s.id} s={s} pending={s.id === firstPendingId} />)
          )}

          <div style={{ height: 8 }} />

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={H2}>最近动态</h2>
            <Link to="/ledger" style={{ fontSize: 12.5 }}>全部流水</Link>
          </div>
          <section className="card" style={{ padding: '4px 18px' }}>
            {v.activities.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '14px 0' }}>还没有动态</div>}
            {v.activities.map((a, i) => <ActivityRow key={`${a.kind}-${a.occurredAt}-${i}`} a={a} first={i === 0} />)}
          </section>
        </section>

        <aside style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {v.alerts.length > 0 && (
            <section className="card" style={{ padding: '16px 18px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16 }}>课时预警</h2>
                <span className="pill danger round" style={{ fontSize: 11.5 }}><span className="num">{v.alertCount}</span> 人</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink-3)' }}>余额已归零或为负。课照常上，欠的课时累计，补缴后自动抵扣</p>
              {v.alerts.map((a, i) => <AlertRow key={a.id} a={a} first={i === 0} />)}
            </section>
          )}

          <section>
            <h2 style={{ fontSize: 16, marginBottom: 10 }}>本月概览</h2>
            <Overview o={v.overview} />
          </section>
        </aside>
      </div>
    </>
  );
}

// ---------- 课程卡 ----------
function SessionCard({ s, pending }: { s: SessionView; pending: boolean }) {
  const taken = s.status === 'taken';
  const to = `/sessions/${s.id}/roll-call`;
  const cardStyle: React.CSSProperties = pending
    ? { border: '1px solid var(--card-today-line)', boxShadow: '0 1px 0 #F2E3D8, 0 6px 18px -12px rgba(120, 70, 40, 0.45)' }
    : {};
  return (
    <article className="card" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 18px', ...cardStyle }}>
      <div style={{ width: 66, flexShrink: 0 }}>
        <div className="num" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: pending ? 'var(--accent-deep)' : undefined }}>{s.startTime}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>至 <span className="num">{s.endTime}</span></div>
      </div>
      <div className="divider-v" />
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.classColor, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{s.className}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}><span className="num">{s.enrolled}</span> 人 · 第 <span className="num">{s.ordinal}</span> 次</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{taken ? <TakenLine s={s} /> : <PlannedLine s={s} />}</div>
      </div>
      {taken ? (
        <span className="pill ok round" style={{ height: 26, padding: '0 11px', fontSize: 12, gap: 6, borderRadius: 13 }}><IconCheck />已点名</span>
      ) : pending ? (
        <span className="pill warn round" style={{ height: 26, padding: '0 11px', fontSize: 12, borderRadius: 13 }}>待点名</span>
      ) : (
        <span className="pill neutral round" style={{ height: 26, padding: '0 11px', fontSize: 12, borderRadius: 13, color: 'var(--ink-3)' }}>未开始</span>
      )}
      {taken ? (
        <Link className="btn md" to={to}>查看</Link>
      ) : pending ? (
        <Link className="btn md primary" to={to} style={{ padding: '0 20px' }}>开始点名</Link>
      ) : (
        <Link className="btn md" to={to}>查看名单</Link>
      )}
    </article>
  );
}

function PlannedLine({ s }: { s: SessionView }) {
  const negs = s.negativeStudents;
  let neg: React.ReactNode = null;
  if (negs.length === 1) {
    neg = <span style={{ color: 'var(--danger-ink)' }}>{negs[0].name} 扣后欠 <span className="num">{num(-negs[0].after)}</span> 课时</span>;
  } else if (negs.length > 1) {
    const total = negs.reduce((a, x) => a + -x.after, 0);
    neg = <span style={{ color: 'var(--danger-ink)' }}>{negs.slice(0, 2).map((x) => x.name).join('、')} 等 <span className="num">{negs.length}</span> 人扣后共欠 <span className="num">{num(total)}</span> 课时</span>;
  }
  return <>本次预计扣 <span className="num">{num(s.hours)}</span> 课时{neg && <> · {neg}</>}</>;
}

function TakenLine({ s }: { s: SessionView }) {
  return (
    <>
      已扣 <span className="num">{num(s.hours)}</span> 课时
      {s.leaveCount > 0 && <> · <span className="num">{s.leaveCount}</span> 人请假未扣</>}
      {s.absentCount > 0 && <> · <span className="num">{s.absentCount}</span> 人缺勤</>}
      {s.takenAt != null && <> · {doneAgo(s.takenAt)}</>}
    </>
  );
}

function doneAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚完成';
  if (min < 60) return `${min} 分钟前完成`;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} 完成`;
}

// ---------- 最近动态 ----------
function ActivityRow({ a, first }: { a: Activity; first: boolean }) {
  const noDeduct = a.kind === 'cancel' || a.kind === 'extra';
  const deltaColor = a.delta < 0 ? 'var(--accent-deep)' : 'var(--ok-ink)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 46, borderTop: first ? undefined : '1px solid var(--line-soft)' }}>
      <span className="num" style={{ width: 44, flexShrink: 0, fontSize: 13, color: 'var(--ink-3)' }}>{a.date}</span>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{a.detail}</span>
      {noDeduct || a.delta === 0 ? (
        <span style={{ width: 74, textAlign: 'right', fontSize: 13, color: 'var(--ink-3)' }}>不扣</span>
      ) : (
        <span className="num" style={{ width: 74, textAlign: 'right', fontSize: 14, color: deltaColor }}>{num(a.delta, { sign: true })} 课时</span>
      )}
    </div>
  );
}

// ---------- 预警 ----------
function AlertRow({ a, first }: { a: AlertStudent; first: boolean }) {
  const owed = a.balance < 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0', marginTop: first ? 6 : 0, borderTop: '1px solid var(--line-soft)' }}>
      <span className={`avatar ${owed ? 'danger' : 'warn'}`}>{a.name.trim().charAt(0)}</span>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          {a.className ?? '未在班'} · {owed ? <>应补 <span className="num">{yuan(a.owedCents)}</span></> : '下次上课起欠'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="num" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1, color: owed ? 'var(--danger)' : 'var(--warn)' }}>{num(a.balance)}</div>
        <div style={{ fontSize: 10.5, color: owed ? 'var(--danger-ink)' : 'var(--ink-3)', marginTop: 2 }}>{owed ? '已欠' : '课时'}</div>
      </div>
      <Link className="btn sm" to={`/students/${a.id}/recharge`}>充值</Link>
    </div>
  );
}

// ---------- 本月概览 ----------
function Overview({ o }: { o: TodayView['overview'] }) {
  let cmp: React.ReactNode;
  let cmpColor = 'var(--ink-3)';
  if (o.prevConsumedHours === 0) {
    cmp = '上月无数据';
  } else {
    const r = (o.consumedHours - o.prevConsumedHours) / o.prevConsumedHours;
    const s = (Math.abs(r) * 100).toFixed(1);
    cmp = <>较上月 <span className="num">{r < 0 ? '−' : '+'}{s}%</span></>;
    cmpColor = r < 0 ? 'var(--danger-ink)' : 'var(--ok-ink)';
  }
  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <div className="kpi"><div className="l">课消课时</div><div className="v">{num(o.consumedHours)}</div><div className="h" style={{ color: cmpColor }}>{cmp}</div></div>
      <div className="kpi"><div className="l">课消收入</div><div className="v">{yuan(o.revenueCents)}</div><div className="h">按各人课包均价结转</div></div>
      <div className="kpi"><div className="l">出勤率</div><div className="v">{pct(o.attendanceRate)}</div><div className="h">请假 <span className="num">{o.leaveCount}</span> 人次</div></div>
      <div className="kpi"><div className="l">在读学生</div><div className="v">{o.activeStudents}</div><div className="h">本月新增 <span className="num">{o.newStudents}</span> 人</div></div>
    </div>
  );
}

// ---------- 全局搜索 ----------
function SearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) { setHits([]); return; }
    const id = ++seq.current;
    const t = setTimeout(() => {
      api.globalSearch(query).then((r) => { if (seq.current === id) { setHits(r); setOpen(true); } }).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  const go = (h: SearchHit) => {
    setOpen(false); setQ('');
    nav(h.kind === 'student' ? `/students/${h.id}` : `/classes/${h.id}`);
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <label className="search-box">
        <IconSearch style={{ color: 'var(--ink-3)' }} />
        <input data-search type="text" placeholder="搜索学生或班级" value={q}
          onChange={(e) => setQ(e.target.value)} onFocus={() => { if (hits.length) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') setOpen(false); }} />
        <span style={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>⌘ /</span>
      </label>
      {open && q.trim() && (
        <div className="card" style={{ position: 'absolute', top: 40, right: 0, width: 300, zIndex: 20, padding: '4px 0', boxShadow: '0 12px 32px -16px rgba(60, 30, 10, .4)', maxHeight: 320, overflow: 'auto' }}>
          {hits.length === 0 && <div className="muted" style={{ padding: '10px 14px', fontSize: 12.5 }}>没有匹配的学生或班级</div>}
          {hits.map((h) => (
            <button key={`${h.kind}-${h.id}`} type="button" onClick={() => go(h)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunk)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <span className={`pill ${h.kind === 'student' ? 'accent' : 'neutral'}`} style={{ flexShrink: 0 }}>{h.kind === 'student' ? '学生' : '班级'}</span>
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{h.title}</span>
                {h.subtitle && <span style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'block' }}>{h.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
