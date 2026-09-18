import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import * as api from '../lib/api';
import type { ClassCard, StudentFilter, StudentRow } from '../lib/api';
import { Avatar, Empty, Loading, PageHeader, balanceColor, useAsync, useRefresh, useToast } from '../components/ui';
import { IconSearch } from '../components/icons';
import { StudentFormModal } from '../components/StudentFormModal';
import { addDays, md, num, todayStr, yuan } from '../lib/format';
import { saveCsv } from '../lib/files';

const PAGE_SIZE = 10;
type Filter = Exclude<StudentFilter, 'left'>;

const FILTERS: { key: Filter; label: string; stat: keyof api.StudentListStats }[] = [
  { key: 'all', label: '全部', stat: 'activeCount' },
  { key: 'owed', label: '已欠课时', stat: 'owedCount' },
  { key: 'low', label: '余额不足', stat: 'lowCount' },
  { key: 'new', label: '本月新增', stat: 'newCount' },
  { key: 'paused', label: '已停课', stat: 'pausedCount' },
];

// 画板列宽
const W = { cls: 118, n: 68, last: 72, owed: 84, st: 96, op: 82 };
const col = (w: number, right = false): CSSProperties => ({ width: w, flexShrink: 0, textAlign: right ? 'right' : undefined });

/** 每周上课次数：各班启用规则的星期数之和；无法得知按每周 2 次 */
function perWeekOf(s: StudentRow, perWeekByClass: Map<string, number>): number {
  const n = s.classes.reduce((acc, c) => acc + (perWeekByClass.get(c.id) ?? 0), 0);
  return n > 0 ? n : 2;
}

/** 状态列：文案 + 颜色 */
function statusOf(s: StudentRow, perWeek: number): { text: string; color: string } {
  if (s.status === 'paused') return { text: '已停课', color: 'var(--ink-3)' };
  if (s.balance < 0) return { text: `已欠 ${num(-s.balance)} 课时`, color: 'var(--danger-ink)' };
  if (s.balance === 0) return { text: '下次上课起欠', color: 'var(--warn-ink)' };
  const days = Math.round((s.balance / perWeek) * 7);
  return { text: `约 ${md(addDays(todayStr(), days))} 用完`, color: 'var(--ink-3)' };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function Students() {
  const nav = useNavigate();
  const toast = useToast();
  const { bump } = useRefresh();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const q = query.trim();
  const { data, loading, error, reload } = useAsync(() => api.listStudents(filter, q || undefined), [filter, q]);
  const classesRes = useAsync(() => api.listClasses(), []);
  const classes: ClassCard[] = classesRes.data?.cards ?? [];

  useEffect(() => { setPage(0); }, [filter, q]);

  const perWeekByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of classes) {
      m.set(c.id, c.rules.filter((r) => r.active).reduce((acc, r) => acc + r.weekdays.length, 0));
    }
    return m;
  }, [classes]);

  const rows = data?.rows ?? [];
  const stats = data?.stats;
  const threshold = stats?.lowBalanceThreshold ?? 3;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount - 1);
  const start = cur * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);

  const exportCsv = async () => {
    if (rows.length === 0) { toast('没有可导出的学生'); return; }
    const head = '姓名,英文名,班级,余额,本月出勤,最近上课,应补缴,状态';
    const lines = rows.map((s) => [
      s.name, s.enName, s.classes.map((c) => c.name).join(' / '), s.balance,
      `${s.monthAttended} / ${s.monthTotal}`, s.lastSessionDate ?? '',
      s.owedCents > 0 ? (s.owedCents / 100).toFixed(2) : '',
      statusOf(s, perWeekOf(s, perWeekByClass)).text,
    ].map(csvCell).join(','));
    try {
      const ok = await saveCsv(`学生名单-${todayStr()}.csv`, '﻿' + [head, ...lines].join('\n'));
      if (ok) toast('已导出', 'ok');
    } catch (e) {
      toast(api.errMsg(e), 'danger');
    }
  };

  const filterLabel = filter === 'paused' ? '已停课' : '在读';

  const header = (
    <PageHeader
      title="学生"
      sub={stats ? `${stats.activeCount} 人在读 · 按剩余课时升序` : '按剩余课时升序'}
      right={<>
        <label className="search-box">
          <IconSearch style={{ color: 'var(--ink-3)' }} />
          <input data-search type="text" placeholder="搜索学生姓名" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn" onClick={exportCsv}>导出名单</button>
        <button className="btn primary" onClick={() => setShowForm(true)}>新增学生</button>
      </>}
    />
  );

  const modal = showForm && (
    <StudentFormModal
      classes={classes}
      onClose={() => setShowForm(false)}
      onDone={() => { setShowForm(false); reload(); bump(); toast('已新增学生', 'ok'); }}
    />
  );

  if (error) return <>{header}<div className="page-body"><div className="err">{error}</div></div>{modal}</>;
  if (!data) return <>{header}<div className="page-body">{loading && <Loading />}</div>{modal}</>;

  const nothingAtAll = filter === 'all' && !q && rows.length === 0;

  return (
    <>
      {header}
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button
                key={f.key} type="button" aria-pressed={on}
                onClick={() => setFilter(f.key)}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 16, fontSize: 12.5, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`,
                  background: on ? 'var(--accent)' : 'var(--surface)',
                  color: on ? 'var(--nav-text-on)' : 'var(--ink-2)',
                }}
              >
                {f.label} <span className="num">{stats?.[f.stat] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {nothingAtAll ? (
          <section className="card">
            <Empty
              title="还没有学生"
              hint="新增第一位学生后，充值课包即可开始点名扣课时"
              action={<button className="btn primary" style={{ marginTop: 8 }} onClick={() => setShowForm(true)}>新增学生</button>}
            />
          </section>
        ) : (
          <>
            <section className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 40, padding: '0 20px', background: 'var(--surface-sunk)', fontSize: 11.5, color: 'var(--ink-3)' }}>
                <span style={{ flexGrow: 1, minWidth: 120 }}>学生</span>
                <span style={col(W.cls)}>所在班级</span>
                <span style={col(W.n, true)}>课时余额</span>
                <span style={col(W.n, true)}>本月出勤</span>
                <span style={col(W.last, true)}>最近上课</span>
                <span style={col(W.owed, true)}>应补缴</span>
                <span style={col(W.st, true)}>状态</span>
                <span style={col(W.op, true)}>操作</span>
              </div>

              {shown.length === 0 && (
                <Empty title="没有匹配的学生" hint={q ? `没有找到「${q}」` : '换个筛选条件试试'} />
              )}

              {shown.map((s) => {
                const st = statusOf(s, perWeekOf(s, perWeekByClass));
                const tone = s.balance < 0 ? 'danger' : s.balance <= threshold ? 'warn' : undefined;
                const rowCls = s.balance < 0 ? 'danger' : s.balance === 0 ? 'warn' : '';
                const filled = s.balance <= 0;
                return (
                  <div
                    key={s.id} role="link" tabIndex={0}
                    className={`trow clickable ${rowCls}`}
                    style={{ gap: 14, height: 56, padding: '0 20px' }}
                    onClick={() => nav(`/students/${s.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') nav(`/students/${s.id}`); }}
                  >
                    <span style={{ flexGrow: 1, minWidth: 120, display: 'flex', alignItems: 'center', gap: 11, overflow: 'hidden' }}>
                      <Avatar name={s.name} tone={tone} />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</span>
                        {s.enName && <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginLeft: 7 }}>{s.enName}</span>}
                      </span>
                    </span>
                    <span style={{ ...col(W.cls), fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.classes.length ? s.classes.map((c) => c.name).join(' / ') : <span className="faint">—</span>}
                    </span>
                    <span className="num" style={{ ...col(W.n, true), fontSize: 17, fontWeight: 600, color: balanceColor(s.balance, threshold) }}>{num(s.balance)}</span>
                    <span className="num" style={{ ...col(W.n, true), fontSize: 13, color: 'var(--ink-2)' }}>{s.monthAttended} / {s.monthTotal}</span>
                    <span className="num" style={{ ...col(W.last, true), fontSize: 13, color: 'var(--ink-3)' }}>{s.lastSessionDate ? md(s.lastSessionDate) : '—'}</span>
                    <span className="num" style={{ ...col(W.owed, true), fontSize: 13, color: s.owedCents > 0 ? 'var(--danger-ink)' : 'var(--ink-3)' }}>{s.owedCents > 0 ? yuan(s.owedCents) : '—'}</span>
                    <span style={{ ...col(W.st, true), fontSize: 12, color: st.color, whiteSpace: 'nowrap' }}>{st.text}</span>
                    <span style={{ ...col(W.op), display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        className={`btn sm ${filled ? 'primary' : ''}`}
                        style={filled ? { fontSize: 12.5, padding: '0 14px' } : undefined}
                        onClick={(e) => { e.stopPropagation(); nav(`/students/${s.id}/recharge`); }}
                      >充值</button>
                    </span>
                  </div>
                );
              })}
            </section>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                显示 <span className="num">{rows.length === 0 ? 0 : start + 1} – {Math.min(start + PAGE_SIZE, rows.length)}</span>，共 <span className="num">{rows.length}</span> 名{filterLabel}学生
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn" style={{ height: 32, padding: '0 13px', borderRadius: 8, fontSize: 12.5, color: cur === 0 ? 'var(--ink-3)' : 'var(--ink)' }}
                  disabled={cur === 0} onClick={() => setPage(cur - 1)}>上一页</button>
                <button type="button" className="btn" style={{ height: 32, padding: '0 13px', borderRadius: 8, fontSize: 12.5, color: cur >= pageCount - 1 ? 'var(--ink-3)' : 'var(--ink)' }}
                  disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}>下一页</button>
              </div>
            </div>
          </>
        )}
      </div>
      {modal}
    </>
  );
}
