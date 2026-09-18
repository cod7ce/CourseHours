import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import * as api from '../lib/api';
import type { LedgerKind, LedgerView } from '../lib/api';
import { saveCsv } from '../lib/files';
import { cnMonth, dt, num, shiftMonth, thisMonth, yuan } from '../lib/format';
import { IconBack, IconNext, IconSearch } from '../components/icons';
import { Empty, Loading, PageHeader, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';

const PAGE_SIZE = 10;
const KINDS: { k: LedgerKind; label: string }[] = [
  { k: 'all', label: '全部' },
  { k: 'consume', label: '消费' },
  { k: 'recharge', label: '充值' },
  { k: 'noshow', label: '请假 / 缺勤' },
  { k: 'adjust', label: '调整与撤销' },
];

// ---------- 画板里的列宽 ----------
const col = (w: number, extra: CSSProperties = {}): CSSProperties => ({ width: w, flexShrink: 0, ...extra });
const colR = (w: number, extra: CSSProperties = {}): CSSProperties => ({ width: w, flexShrink: 0, textAlign: 'right', ...extra });
const grow: CSSProperties = { flexGrow: 1, minWidth: 0 };
const pill = (bg: string, ink: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', height: 21, padding: '0 8px', borderRadius: 6, background: bg, color: ink, fontSize: 11 });

function typePill(r: LedgerView): ReactNode {
  if (r.type === 'recharge') return <span style={pill('var(--ok-soft)', 'var(--ok-ink)')}>充值</span>;
  if (r.type === 'adjust') return <span style={pill('var(--neutral-soft)', 'var(--neutral-ink)')}>调整</span>;
  if (r.attendanceStatus === 'leave') return <span style={pill('var(--neutral-soft)', 'var(--neutral-ink)')}>请假</span>;
  if (r.attendanceStatus === 'absent') return <span style={pill('var(--neutral-soft)', 'var(--neutral-ink)')}>缺勤</span>;
  return <span style={pill('var(--accent-soft)', 'var(--accent-deep)')}>消费</span>;
}

function deltaColor(d: number): string {
  if (d > 0) return 'var(--ok-ink)';
  if (d < 0) return 'var(--accent-deep)';
  return 'var(--ink-3)';
}

function rowClass(r: LedgerView): string {
  if (r.balanceAfter < 0) return 'danger';
  if (r.type === 'adjust') return 'neutral';
  if (r.type === 'recharge') return 'ok';
  return '';
}

function Stat({ label, value, valueColor, hint, hintColor }: { label: string; value: string; valueColor?: string; hint: ReactNode; hintColor?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '13px 18px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 3 }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 600, color: valueColor, lineHeight: 1.1 }}>{value}</span>
        <span style={{ fontSize: 11.5, color: hintColor ?? 'var(--ink-3)' }}>{hint}</span>
      </div>
    </div>
  );
}

export function Ledger() {
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();

  const [month, setMonth] = useState(thisMonth());
  const [kind, setKind] = useState<LedgerKind>('all');
  const [classId, setClassId] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  // 学生姓名输入防抖
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  // 筛选变化回到第一页
  useEffect(() => { setPage(0); }, [month, kind, classId, query]);

  const filter = { month, kind, classId: classId || null, query: query || null };
  const { data, loading, error, reload } = useAsync(() => api.listLedger({ ...filter, page, pageSize: PAGE_SIZE }), [month, kind, classId, query, page]);
  const classes = useAsync(() => api.listClasses(true), []);

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const sm = data?.summary;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await api.exportLedgerCsv(filter);
      if (await saveCsv(`流水-${month}.csv`, csv)) toast('已导出 CSV', 'ok');
    } catch (e) {
      toast(api.errMsg(e), 'danger');
    } finally {
      setExporting(false);
    }
  };

  const undo = async (r: LedgerView) => {
    const ok = await confirm({
      title: '撤销这笔流水？',
      body: <>{r.studentName} · {r.reason}（{num(r.delta, { sign: true })} 课时）。会写入一条冲正记录，原记录保留并标为「已冲正」。</>,
      danger: true, confirmText: '撤销',
    });
    if (!ok) return;
    try {
      await api.undoEntry(r.id);
      toast('已撤销', 'ok');
      reload(); bump();
    } catch (e) {
      toast(api.errMsg(e), 'danger');
    }
  };

  const navBtn: CSSProperties = { width: 36, height: 36, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' };
  const vline: CSSProperties = { width: 1, height: 20, background: 'var(--line-mid)' };

  return (
    <>
      <PageHeader title="课时流水" sub="全机构逐笔记录 · 每一次扣减、充值、抵扣、冲正都可追溯"
        right={<>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-ctrl)', borderRadius: 9, overflow: 'hidden' }}>
            <button type="button" aria-label="上个月" style={navBtn} onClick={() => setMonth((m) => shiftMonth(m, -1))}><IconBack size={15} /></button>
            <span style={vline} />
            <button type="button" className="num" style={{ height: 36, padding: '0 14px', border: 0, background: 'transparent', fontSize: 13.5, cursor: 'pointer', color: 'var(--ink)' }} onClick={() => setMonth(thisMonth())} title="回到本月">
              {cnMonth(month)}
            </button>
            <span style={vline} />
            <button type="button" aria-label="下个月" style={navBtn} onClick={() => setMonth((m) => shiftMonth(m, 1))}><IconNext size={15} /></button>
          </div>
          <button type="button" className="btn" style={{ fontSize: 13.5, padding: '0 16px' }} disabled={exporting} onClick={exportCsv}>导出 CSV</button>
        </>} />

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 四格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, background: 'var(--line-mid)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
          <Stat label="本月充值" value={num(sm?.rechargeHours ?? 0, { sign: true })} valueColor="var(--ok-ink)"
            hint={<>课时 · <span className="num">{yuan(sm?.rechargeCents ?? 0)}</span></>} />
          <Stat label="本月课消" value={num(-(sm?.consumedHours ?? 0))} valueColor="var(--accent-deep)"
            hint={<>课时 · <span className="num">{yuan(sm?.consumeCents ?? 0)}</span></>} />
          <Stat label="手动调整" value={num(sm?.adjustHours ?? 0, { sign: true })}
            hint={<>课时 · <span className="num">{sm?.reversalCount ?? 0}</span> 笔冲正</>} />
          <Stat label="期末结存" value={num(sm?.unconsumedHours ?? 0)}
            hint={(sm?.owedHours ?? 0) > 0 ? <>课时 · 另有 <span className="num">{num(sm!.owedHours)}</span> 课时欠账</> : '课时 · 无欠账'}
            hintColor={(sm?.owedHours ?? 0) > 0 ? 'var(--danger-ink)' : undefined} />
        </div>

        {/* 筛选行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {KINDS.map((it) => {
            const on = it.k === kind;
            return (
              <button key={it.k} type="button" onClick={() => setKind(it.k)} style={{
                height: 32, padding: '0 14px', borderRadius: 16, fontSize: 12.5, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`,
                background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--nav-text-on)' : 'var(--ink-2)',
              }}>{it.label}</button>
            );
          })}
          <span style={{ width: 1, height: 22, background: 'var(--line-ctrl)', margin: '0 4px' }} />
          <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}
            style={{ width: 'auto', height: 32, padding: '0 30px 0 13px', fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface)' }}>
            <option value="">全部班级</option>
            {(classes.data?.cards ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ flexGrow: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', background: 'var(--surface)', border: '1px solid var(--line-ctrl)', borderRadius: 9 }}>
            <IconSearch size={14} style={{ color: 'var(--ink-3)' }} />
            <input type="text" data-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="按学生姓名筛选" aria-label="按学生姓名筛选"
              style={{ border: 0, outline: 0, background: 'transparent', fontSize: 12.5, width: 130, color: 'var(--ink)' }} />
          </label>
        </div>

        {error && <div className="err">{error}</div>}

        {/* 表格 */}
        <section className="card" style={{ overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, height: 36, padding: '0 20px', background: 'var(--surface-sunk)', fontSize: 11.5, color: 'var(--ink-3)' }}>
            <span style={col(96)}>时间</span>
            <span style={col(90)}>学生</span>
            <span style={col(120)}>班级</span>
            <span style={col(56)}>类型</span>
            <span style={grow}>说明</span>
            <span style={colR(60)}>变动</span>
            <span style={colR(58)}>余额</span>
            <span style={colR(80)}>金额</span>
            <span style={colR(52)}>操作</span>
          </div>

          {!data && loading && <Loading />}
          {data && rows.length === 0 && <Empty title="这个月还没有流水" hint={kind !== 'all' || classId || query ? '换个筛选条件试试' : undefined} />}
          {rows.map((r) => {
            const rc = rowClass(r);
            const strike = r.reversed ? 'strike' : '';
            return (
              <div key={r.id} className={`trow ${rc}`} style={{ gap: 13, minHeight: 46, padding: '0 20px' }}>
                <span className={`num ${strike}`} style={col(96, { fontSize: 12.5, color: r.reversed ? undefined : 'var(--ink-2)' })}>{dt(r.occurredAt)}</span>
                <span className={strike} style={col(90, { fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                  {r.reversed ? r.studentName : <Link to={`/students/${r.studentId}`} style={{ color: 'inherit' }}>{r.studentName}</Link>}
                </span>
                <span className={strike} style={col(120, { fontSize: 12, color: r.reversed ? undefined : 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{r.className ?? '—'}</span>
                <span style={col(56)}>{typePill(r)}</span>
                <span style={{ ...grow, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className={strike}>
                    {r.type === 'consume' && r.sessionStart ? <><span className="num">{r.sessionStart}</span> 课次 · </> : null}
                    {r.reason}
                    {r.type === 'recharge' && r.packageUnitPrice != null && <>（<span className="num">{yuan(r.packageUnitPrice)}</span> / 次）</>}
                  </span>
                  {r.reversed && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)' }}>已冲正</span>}
                </span>
                <span className={`num ${strike}`} style={colR(60, { fontSize: 14, color: r.reversed ? undefined : deltaColor(r.delta) })}>{num(r.delta, { sign: true })}</span>
                <span className="num" style={colR(58, { fontSize: 14, fontWeight: 600, color: r.balanceAfter < 0 ? 'var(--danger)' : r.balanceAfter === 0 ? 'var(--warn)' : undefined })}>{num(r.balanceAfter)}</span>
                {r.amountCents != null && r.amountCents !== 0
                  ? <span className={`num ${strike}`} style={colR(80, { fontSize: 12.5, color: r.type === 'recharge' ? undefined : 'var(--ink-3)', fontWeight: r.type === 'recharge' ? 600 : undefined })}>{yuan(r.amountCents)}</span>
                  : <span style={colR(80, { fontSize: 12, color: 'var(--ink-4)' })}>—</span>}
                <span style={colR(52)}>
                  {r.undoable
                    ? <a href="#" style={{ fontSize: 12 }} onClick={(e) => { e.preventDefault(); undo(r); }}>撤销</a>
                    : r.type === 'recharge' && !r.reversed
                      ? <Link to={`/students/${r.studentId}`} style={{ fontSize: 12 }}>详情</Link>
                      : null}
                </span>
              </div>
            );
          })}
        </section>

        {/* 分页 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            显示 <span className="num">{from} – {to}</span>，本月共 <span className="num">{total}</span> 条记录
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" disabled={!hasPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ height: 32, padding: '0 13px', border: '1px solid var(--line-ctrl)', borderRadius: 8, background: 'var(--surface)', color: hasPrev ? 'var(--ink)' : 'var(--ink-3)', fontSize: 12.5, cursor: 'pointer' }}>上一页</button>
            <button type="button" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}
              style={{ height: 32, padding: '0 13px', border: '1px solid var(--line-ctrl)', borderRadius: 8, background: 'var(--surface)', color: hasNext ? 'var(--ink)' : 'var(--ink-3)', fontSize: 12.5, cursor: 'pointer' }}>下一页</button>
          </div>
        </div>
      </div>
    </>
  );
}
