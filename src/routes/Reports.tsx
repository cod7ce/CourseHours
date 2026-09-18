import { useState } from 'react';
import * as api from '../lib/api';
import type { ClassReportRow, Report } from '../lib/api';
import { Empty, Loading, PageHeader, useAsync, useToast } from '../components/ui';
import { IconBack, IconNext } from '../components/icons';
import { saveCsv } from '../lib/files';
import { cnDate, cnMonth, num, pct, shiftMonth, thisMonth, yuan } from '../lib/format';

const H2: React.CSSProperties = { fontSize: 16 };
const P: React.CSSProperties = { margin: '4px 0 0', fontSize: 11.5, color: 'var(--ink-3)' };
const COL = { sessions: 76, hours: 76, rate: 68, price: 88, revenue: 104, unconsumed: 92 };
const CELL: React.CSSProperties = { flexShrink: 0, textAlign: 'right', fontSize: 13.5 };
const CHART_H = 168; // 柱子满刻度高度
const BOX_H = 188; // 图区总高（留出顶部标值空间）

export function Reports() {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [exporting, setExporting] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);
  const { data, loading, error } = useAsync(() => api.getReport(month), [month]);
  const atCurrent = month >= thisMonth();

  const exportCsv = async () => {
    setExporting(true); setOpErr(null);
    try {
      const csv = await api.exportReportCsv(month);
      if (await saveCsv(`经营报表-${month}.csv`, csv)) toast('报表已导出', 'ok');
    } catch (e) { setOpErr(api.errMsg(e)); } finally { setExporting(false); }
  };

  const right = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-ctrl)', borderRadius: 9, overflow: 'hidden' }}>
        <button type="button" aria-label="上个月" onClick={() => setMonth((m) => shiftMonth(m, -1))}
          style={{ width: 36, height: 36, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconBack size={15} /></button>
        <span style={{ width: 1, height: 20, background: 'var(--line-mid)' }} />
        <button type="button" className="num" onClick={() => setMonth(thisMonth())} title={atCurrent ? undefined : '回到本月'}
          style={{ height: 36, padding: '0 14px', border: 0, background: 'transparent', fontSize: 13.5, cursor: atCurrent ? 'default' : 'pointer' }}>{cnMonth(month)}</button>
        <span style={{ width: 1, height: 20, background: 'var(--line-mid)' }} />
        <button type="button" aria-label="下个月" disabled={atCurrent} onClick={() => setMonth((m) => shiftMonth(m, 1))}
          style={{ width: 36, height: 36, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconNext size={15} /></button>
      </div>
      <button className="btn" style={{ padding: '0 16px', fontSize: 13.5 }} disabled={exporting || !data} onClick={exportCsv}>导出 CSV</button>
    </>
  );

  if (error) return <><PageHeader title="经营报表" right={right} /><div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <><PageHeader title="经营报表" right={right} /><div className="page-body">{loading && <Loading />}</div></>;

  const r: Report = data;
  const sub = r.isCurrentMonth
    ? <>{r.monthLabel} · 截至 {cnDate(r.today)} 已完成 <span className="num">{r.sessionsTaken}</span> 节课</>
    : <>{r.monthLabel} · 共 <span className="num">{r.sessionsTaken}</span> 节课</>;
  const spare = Math.max(0, r.totalCapacity - r.totalEnrolled);

  return (
    <>
      <PageHeader title="经营报表" sub={sub} right={right} />
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {opErr && <div className="err">{opErr}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          <Kpi l="课消课时" v={num(r.consumedHours)} hint={<Delta r={r} month={month} />} />
          <Kpi l="课消收入（已确认）" v={yuan(r.consumeRevenueCents)} hint="按各人课包均价逐笔结转" />
          <Kpi l="本月充值收款" v={yuan(r.rechargeCents)} hint={
            r.rechargeCount > 0
              ? <><span className="num">{r.rechargeCount}</span> 笔 · <span className="num">{num(r.rechargeSessions)}</span> 课次{r.rechargeSessions > 0 && <> · 均价 <span className="num">{yuan(Math.round(r.rechargeCents / r.rechargeSessions))}</span></>}</>
              : '本月没有充值'
          } />
          <Kpi l="出勤率" v={pct(r.attendanceRate)} hint={<>请假 <span className="num">{r.leaveCount}</span> · 缺勤 <span className="num">{r.absentCount}</span> 人次，均不扣</>} />
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <section className="card" style={{ flexGrow: 1, minWidth: 0, padding: '18px 20px 14px' }}>
            <h2 style={H2}>近 6 个月课消课时</h2>
            <p style={P}>单位：课时，按点名确认日期归集</p>
            <BarChart r={r} />
          </section>

          <section className="card" style={{ width: 372, flexShrink: 0, padding: '18px 20px 14px' }}>
            <h2 style={H2}>班级满员度</h2>
            <p style={P}>在读人数 / 班级上限</p>
            {r.classes.length === 0 ? (
              <Empty title="还没有在读班级" hint="新建班级并加入学生后，这里会显示满员度" />
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginTop: 16 }}>
                  {r.classes.map((c) => {
                    const w = c.capacity > 0 ? Math.min(100, Math.round((c.enrolled / c.capacity) * 100)) : 0;
                    return (
                      <div key={c.classId}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.className}</span>
                          <span className="num" style={{ color: 'var(--ink-2)', flexShrink: 0 }}>{c.enrolled} / {c.capacity}</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: 'var(--neutral-soft)' }}>
                          <div style={{ width: `${w}%`, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>还可招收</span>
                  <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>{spare} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', fontFamily: 'var(--font-body)' }}>人</span></span>
                </div>
              </>
            )}
          </section>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <section className="card" style={{ flexGrow: 1, flexBasis: 700, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 46, padding: '0 20px', borderBottom: '1px solid var(--line-faint)' }}>
              <h2 style={{ ...H2, whiteSpace: 'nowrap', flexShrink: 0 }}>班级课消明细</h2>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>单价按每名学生充值时的「总金额 ÷ 课次」逐包结转，班级均价为加权值；未消耗课时只计正余额，欠课时单列</span>
            </div>
            {r.classes.length === 0 ? (
              <Empty title="本月没有班级数据" hint="还没有在读班级，课消明细为空" />
            ) : (
              <>
                <div className="thead" style={{ height: 36, padding: '0 20px', gap: 16 }}>
                  <span style={{ flexGrow: 1, minWidth: 96 }}>班级</span>
                  <span style={{ ...CELL, width: COL.sessions, fontSize: 11.5 }}>本月课次</span>
                  <span style={{ ...CELL, width: COL.hours, fontSize: 11.5 }}>课消课时</span>
                  <span style={{ ...CELL, width: COL.rate, fontSize: 11.5 }}>出勤率</span>
                  <span style={{ ...CELL, width: COL.price, fontSize: 11.5 }}>加权均价</span>
                  <span style={{ ...CELL, width: COL.revenue, fontSize: 11.5 }}>课消收入</span>
                  <span style={{ ...CELL, width: COL.unconsumed, fontSize: 11.5 }}>未消耗课时</span>
                </div>
                {r.classes.map((c) => <ClassLine key={c.classId} c={c} />)}
                <TotalLine r={r} />
              </>
            )}
          </section>

          <aside style={{ flexBasis: 300, flexGrow: 1, minWidth: 250, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section className="card" style={{ padding: '15px 18px' }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>未消耗课时（预收）</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1 }}>{num(r.unconsumedHours)}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>课时 · <span className="num">{r.unconsumedStudents}</span> 人</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>估算 <span className="num" style={{ color: 'var(--ink-2)' }}>{yuan(r.unconsumedValueCents)}</span> · 按各人课包均价折算，仅供参考</div>
            </section>
            <section className="card" style={{ padding: '15px 18px', background: 'var(--danger-tint)', borderColor: 'var(--banner-danger-line)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--danger-ink)' }}>已欠课时（应收）</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.1, color: 'var(--danger-ink)' }}>{num(r.owedHours)}</span>
                <span style={{ fontSize: 11.5, color: 'var(--danger-ink)' }}>课时 · <span className="num">{r.owedStudents}</span> 人</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--danger-ink)', marginTop: 6 }}>应收 <span className="num">{yuan(r.owedCents)}</span> · 与预收不相抵，补缴后自动抵扣</div>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}

// ---------- KPI ----------
function Kpi({ l, v, hint }: { l: string; v: string; hint: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{l}</div>
      <div className="num" style={{ fontSize: 30, fontWeight: 600, marginTop: 4, lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function Delta({ r, month }: { r: Report; month: string }) {
  const prevLabel = `${Number(shiftMonth(month, -1).split('-')[1])} 月`;
  if (r.prevConsumedHours <= 0) return <>上月无数据</>;
  const d = (r.consumedHours - r.prevConsumedHours) / r.prevConsumedHours;
  const pctText = `${Math.abs(d * 100).toFixed(1)}%`;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const color = d > 0 ? 'var(--ok-ink)' : d < 0 ? 'var(--danger-ink)' : 'var(--ink-3)';
  return <span style={{ color }}>较 {prevLabel} <span className="num">{sign}{pctText}</span></span>;
}

// ---------- 柱状图（纯 div） ----------
function BarChart({ r }: { r: Report }) {
  const series = r.series;
  const max = Math.max(0, ...series.map((p) => p.consumedHours));
  const top = Math.max(40, Math.ceil(max / 40) * 40);
  const mid = top / 2;
  const h = (v: number) => Math.round((Math.max(0, v) / top) * CHART_H);
  const tick: React.CSSProperties = { position: 'absolute', right: 0, fontSize: 11, color: 'var(--ink-4)' };
  const grid = (bottom: number, strong = false): React.CSSProperties => ({ position: 'absolute', left: 0, right: 0, bottom, height: 1, background: strong ? 'var(--line-grid)' : 'var(--line-faint)' });

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <div style={{ width: 30, flexShrink: 0, position: 'relative', height: BOX_H }}>
          <span className="num" style={{ ...tick, bottom: CHART_H - 6 }}>{top}</span>
          <span className="num" style={{ ...tick, bottom: CHART_H / 2 - 6 }}>{num(mid)}</span>
          <span className="num" style={{ ...tick, bottom: -6 }}>0</span>
        </div>
        <div style={{ flexGrow: 1, minWidth: 0, position: 'relative', height: BOX_H }}>
          <div style={grid(CHART_H)} />
          <div style={grid(CHART_H / 2)} />
          <div style={grid(0, true)} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 1, height: BOX_H - 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            {series.map((p) => (
              <div key={p.month} style={{ width: 56, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {p.isCurrent && <div className="num" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent-deep)', marginBottom: 5 }}>{num(p.consumedHours)}</div>}
                <div style={{ width: 40, height: h(p.consumedHours), borderRadius: '4px 4px 0 0', background: p.isCurrent ? 'var(--accent-dark)' : 'var(--accent-mid)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <div style={{ width: 30, flexShrink: 0 }} />
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between' }}>
          {series.map((p) => (
            <span key={p.month} style={{ width: 56, textAlign: 'center', fontSize: 11.5, color: p.isCurrent ? 'var(--accent-deep)' : 'var(--ink-3)', fontWeight: p.isCurrent ? 600 : 400 }}>{p.label}</span>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- 明细表 ----------
function ClassLine({ c }: { c: ClassReportRow }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 44, padding: '0 20px', borderTop: '1px solid var(--line-soft)' }}>
      <span style={{ flexGrow: 1, minWidth: 96, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: c.classColor, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.className}</span>
      </span>
      <span className="num" style={{ ...CELL, width: COL.sessions }}>{c.sessions}</span>
      <span className="num" style={{ ...CELL, width: COL.hours }}>{num(c.consumedHours)}</span>
      <span className="num" style={{ ...CELL, width: COL.rate }}>{pct(c.attendanceRate)}</span>
      <span className="num" style={{ ...CELL, width: COL.price, color: 'var(--ink-2)' }}>{c.consumedHours > 0 ? yuan(c.avgPriceCents) : '—'}</span>
      <span className="num" style={{ ...CELL, width: COL.revenue }}>{yuan(c.revenueCents)}</span>
      <span className="num" style={{ ...CELL, width: COL.unconsumed, color: 'var(--ink-2)' }}>{num(c.unconsumedHours)}</span>
    </div>
  );
}

function TotalLine({ r }: { r: Report }) {
  const sessions = r.classes.reduce((s, c) => s + c.sessions, 0);
  const hours = r.classes.reduce((s, c) => s + c.consumedHours, 0);
  const revenue = r.classes.reduce((s, c) => s + c.revenueCents, 0);
  const unconsumed = r.classes.reduce((s, c) => s + c.unconsumedHours, 0);
  const avg = hours > 0 ? Math.round(revenue / hours) : null;
  const bold: React.CSSProperties = { ...CELL, fontSize: 14, fontWeight: 600 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 46, padding: '0 20px', borderTop: '1px solid var(--line-ctrl)', background: 'var(--surface-sunk)' }}>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>合计</span>
      <span className="num" style={{ ...bold, width: COL.sessions }}>{sessions}</span>
      <span className="num" style={{ ...bold, width: COL.hours }}>{num(hours)}</span>
      <span className="num" style={{ ...bold, width: COL.rate }}>{pct(r.attendanceRate)}</span>
      <span className="num" style={{ ...bold, width: COL.price }}>{avg == null ? '—' : yuan(avg)}</span>
      <span className="num" style={{ ...bold, width: COL.revenue }}>{yuan(revenue)}</span>
      <span className="num" style={{ ...bold, width: COL.unconsumed }}>{num(unconsumed)}</span>
    </div>
  );
}
