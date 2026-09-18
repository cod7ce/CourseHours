import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as api from '../lib/api';
import type { ClassCard, RuleSummary } from '../lib/api';
import { Empty, Loading, PageHeader, useAsync } from '../components/ui';
import { IconPlus } from '../components/icons';
import { ClassFormModal } from '../components/ClassFormModal';
import { md, num, yuan } from '../lib/format';

const LABEL: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)' };
const BIG: React.CSSProperties = { fontSize: 24, fontWeight: 600, marginTop: 3, lineHeight: 1.1 };
const UNIT: React.CSSProperties = { fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', fontFamily: 'var(--font-body)' };

/** rules[0] 文案：「周二 / 周四 14:00 – 15:30 · A 教室」 */
export function ruleText(r: RuleSummary | undefined, fallbackRoom: string | null): string | null {
  if (!r) return null;
  const room = r.room ?? fallbackRoom;
  return `${r.weekdaysText} ${r.startTime} – ${r.endTime}${room ? ` · ${room}` : ''}`;
}

export function Classes() {
  const nav = useNavigate();
  // showEnded = true 时只显示已结束的班级
  const [showEnded, setShowEnded] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.listClasses(true), []);

  const right = (
    <>
      <button className={`btn ${showEnded ? 'primary' : ''}`} onClick={() => setShowEnded((v) => !v)}>{showEnded ? '返回在读班级' : '已结束的班级'}</button>
      <button className="btn primary" onClick={() => setCreating(true)}>新建班级</button>
    </>
  );

  if (error) return <><PageHeader title="班级" right={right} /><div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <><PageHeader title="班级" right={right} /><div className="page-body">{loading && <Loading />}</div></>;

  const { stats } = data;
  const endedCount = data.cards.filter((c) => c.status === 'ended').length;
  const cards = data.cards.filter((c) => (showEnded ? c.status === 'ended' : c.status === 'active'));
  const spare = Math.max(0, stats.capacity - stats.enrolled);
  const sub = showEnded
    ? <><span className="num">{endedCount}</span> 个已结束的班级 · 数据与流水都保留，可随时查看</>
    : <><span className="num">{stats.classCount}</span> 个在读班级 · <span className="num">{stats.enrolled}</span> 人 · 本月 <span className="num">{stats.monthSessions}</span> 节课</>;

  return (
    <>
      <PageHeader title="班级" sub={sub} right={right} />
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {!showEnded && <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <div className="kpi" style={{ padding: '14px 18px' }}>
            <div style={LABEL}>在班学生</div>
            <div className="num" style={BIG}>{stats.enrolled} <span style={UNIT}>/ <span className="num">{stats.capacity}</span> 容量</span></div>
          </div>
          <div className="kpi" style={{ padding: '14px 18px' }}>
            <div style={LABEL}>本月课消</div>
            <div className="num" style={BIG}>{num(stats.monthConsumed)} <span style={UNIT}>课时</span></div>
          </div>
          <div className="kpi" style={{ padding: '14px 18px' }}>
            <div style={LABEL}>本月课消收入</div>
            <div className="num" style={BIG}>{yuan(stats.monthRevenueCents)}</div>
          </div>
          <div className="kpi" style={{ padding: '14px 18px' }}>
            <div style={LABEL}>还可招收</div>
            <div className="num" style={BIG}>{spare} <span style={UNIT}>人</span></div>
          </div>
        </div>}

        {cards.length === 0 && showEnded ? (
          <div className="card">
            <Empty title="还没有已结束的班级" hint="在班级详情页底部「结束班级」后，班级会出现在这里，历史点名和流水都还在" />
          </div>
        ) : cards.length === 0 ? (
          <div className="card">
            <Empty title="还没有在读班级" hint="新建一个班级，设定上课时段和人数上限，就可以排课点名了"
              action={<button className="btn primary" style={{ marginTop: 6 }} onClick={() => setCreating(true)}>新建班级</button>} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>
            {cards.map((c) => <Card key={c.id} c={c} />)}
            {!showEnded && <button type="button" onClick={() => setCreating(true)}
              style={{
                background: 'transparent', border: '1.5px dashed var(--dashed)', borderRadius: 14, padding: '17px 18px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer',
                color: 'var(--ink-3)', minHeight: 200,
              }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--circle-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-deep)' }}>
                <IconPlus size={20} sw={1.8} />
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>新建班级</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', lineHeight: 1.6 }}>设定上课时段、人数上限<br />和默认课次数</span>
            </button>}
          </div>
        )}
      </div>

      {creating && (
        <ClassFormModal onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); reload(); nav(`/classes/${id}`); }} />
      )}
    </>
  );
}

function Card({ c }: { c: ClassCard }) {
  const active = c.status === 'active';
  const activeRules = c.rules.filter((r) => r.active);
  const rule = activeRules.length > 1
    ? activeRules.map((r) => `${r.weekdaysText} ${r.startTime} – ${r.endTime}`).join(' · ') + (c.room ? ` · ${c.room}` : '')
    : ruleText(activeRules[0] ?? c.rules[0], c.room);
  const fill = c.capacity > 0 ? Math.min(100, Math.round((c.enrolled / c.capacity) * 100)) : 0;
  const more = c.enrolled - c.initials.length;
  const rollTo = c.nextSessionId ? `/sessions/${c.nextSessionId}/roll-call` : null;

  return (
    <article className="card" style={{ padding: '17px 18px', opacity: active ? 1 : 0.85 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flexShrink: 0 }} />
        <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        <div style={{ flexGrow: 1 }} />
        <span className={`pill ${active ? 'ok' : 'neutral'}`} style={{ height: 21, padding: '0 8px' }}>{active ? '在读' : '已结束'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
        {rule ?? <span className="faint">未设置上课时间</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
        已上 <span className="num">{c.takenCount}</span> 次 · {c.generatedThrough ? <>已排到 <span className="num">{md(c.generatedThrough)}</span></> : '尚未排课'}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 15 }}>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>在班人数</span>
        <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{c.enrolled} / {c.capacity}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--neutral-soft)', marginTop: 6 }}>
        <div style={{ width: `${fill}%`, height: 6, borderRadius: 3, background: c.color }} />
      </div>

      <div style={{ display: 'flex', gap: 5, marginTop: 14, minHeight: 25 }}>
        {c.initials.slice(0, 5).map((s, i) => (
          <span key={i} style={{ width: 25, height: 25, borderRadius: '50%', background: 'var(--neutral-soft)', color: 'var(--avatar-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 11 }}>{s}</span>
        ))}
        {more > 0 && (
          <span className="num" style={{ width: 25, height: 25, borderRadius: '50%', background: 'var(--surface-soft)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>+{more}</span>
        )}
        {c.enrolled === 0 && <span className="faint" style={{ fontSize: 11.5, alignSelf: 'center' }}>还没有学生</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, background: 'var(--line-faint)', border: '1px solid var(--line-faint)', borderRadius: 10, overflow: 'hidden', marginTop: 14 }}>
        <MiniStat l="本月课次" v={String(c.monthSessions)} />
        <MiniStat l="课消" v={num(c.monthConsumed)} />
        <MiniStat l="收入" v={yuan(c.monthRevenueCents)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <Link className="btn sm primary" to={`/classes/${c.id}`} style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}>查看班级</Link>
        {rollTo ? (
          <Link className="btn sm" to={rollTo} style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}>点名</Link>
        ) : (
          <button className="btn sm" disabled title="没有待点名的课次" style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}>点名</button>
        )}
        <div style={{ flexGrow: 1 }} />
        {c.owedCount > 0 ? (
          <span className="pill danger round"><span className="num">{c.owedCount}</span> 人欠课时</span>
        ) : c.zeroCount > 0 ? (
          <span className="pill warn round"><span className="num">{c.zeroCount}</span> 人余额为 0</span>
        ) : null}
      </div>
    </article>
  );
}

function MiniStat({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ background: 'var(--surface-input)', padding: '9px 10px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{l}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  );
}
