import { DatePicker } from '../components/pickers';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import * as api from '../lib/api';
import type { LedgerView, PackageView, StudentDetail as StudentDetailData } from '../lib/api';
import { Avatar, Empty, Loading, Modal, PageHeader, balanceColor, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';
import { IconWarn } from '../components/icons';
import { StudentFormModal } from '../components/StudentFormModal';
import { dateOf, md, num, studentStatusLabel, todayStr, yuan } from '../lib/format';

const LEDGER_PAGE = 50;
type LedgerKind = 'all' | 'recharge' | 'consume' | 'adjust';
const KINDS: { key: LedgerKind; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'recharge', label: '充值' }, { key: 'consume', label: '消费' }, { key: 'adjust', label: '调整' },
];

const col = (w: number, right = false): CSSProperties => ({ width: w, flexShrink: 0, textAlign: right ? 'right' : undefined });
const vline: CSSProperties = { width: 1, alignSelf: 'stretch', background: 'var(--line-faint)' };
const kv: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--ink-3)' };
const kvVal: CSSProperties = { color: 'var(--ink)', textAlign: 'right' };
const h2: CSSProperties = { fontSize: 15 };

function typeOf(e: LedgerView): { label: string; bg: string; fg: string } {
  if (e.type === 'recharge') return { label: '充值', bg: 'var(--ok-soft)', fg: 'var(--ok-ink)' };
  if (e.type === 'adjust') return { label: '调整', bg: 'var(--class-2-soft)', fg: 'var(--ok-ink)' };
  if (e.attendanceStatus === 'leave') return { label: '请假', bg: 'var(--neutral-soft)', fg: 'var(--neutral-ink)' };
  if (e.attendanceStatus === 'absent') return { label: '缺勤', bg: 'var(--neutral-soft)', fg: 'var(--neutral-ink)' };
  return { label: '消费', bg: 'var(--accent-soft)', fg: 'var(--accent-deep)' };
}

function deltaColor(d: number): string {
  if (d < 0) return 'var(--accent-deep)';
  if (d > 0) return 'var(--ok-ink)';
  return 'var(--ink-3)';
}

export function StudentDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();

  const { data, loading, error, reload } = useAsync(() => api.getStudent(id, 0, LEDGER_PAGE), [id]);
  const aux = useAsync(() => Promise.all([api.listClasses(), api.getSettings()]), []);
  const classCards = aux.data?.[0].cards ?? [];
  const settings = aux.data?.[1] ?? null;
  const threshold = settings?.alerts.lowBalanceThreshold ?? 3;
  const presentHours = settings?.hoursRule.present ?? 1;

  const [kind, setKind] = useState<LedgerKind>('all');
  const [extra, setExtra] = useState<LedgerView[]>([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const [modal, setModal] = useState<null | 'edit' | 'leave' | 'adjust'>(null);
  const [undoErr, setUndoErr] = useState<string | null>(null);

  // 学生切换或数据重载后，丢掉追加的分页
  useEffect(() => { setExtra([]); setUndoErr(null); }, [data]);

  const ledger = useMemo(() => (data ? [...data.ledger, ...extra] : []), [data, extra]);
  const shown = useMemo(() => (kind === 'all' ? ledger : ledger.filter((e) => e.type === kind)), [ledger, kind]);

  const afterWrite = (msg: string) => { reload(); bump(); toast(msg, 'ok'); };

  const loadMore = async () => {
    if (!data) return;
    setMoreBusy(true);
    try {
      const page = Math.floor(ledger.length / LEDGER_PAGE);
      const more = await api.listStudentLedger(id, page, LEDGER_PAGE);
      setExtra((s) => [...s, ...more]);
    } catch (e) {
      toast(api.errMsg(e), 'danger');
    } finally {
      setMoreBusy(false);
    }
  };

  const undo = async (e: LedgerView) => {
    const t = typeOf(e).label;
    const ok = await confirm({
      title: `撤销这条${t}记录？`,
      body: <>将写入一条反向记录抵消 {md(dateOf(e.occurredAt))} 的「{e.reason}」，余额相应回退 <span className="num">{num(-e.delta, { sign: true })}</span> 课时。原记录保留并标记为已冲正。</>,
      danger: true, confirmText: '撤销',
    });
    if (!ok) return;
    setUndoErr(null);
    try {
      await api.undoEntry(e.id);
      afterWrite('已撤销');
    } catch (err) {
      setUndoErr(api.errMsg(err));
    }
  };

  // 上课规律：班级规则 + 近三个月出勤
  const ruleText = useMemo(() => {
    if (!data) return '';
    const ids = new Set(data.classes.map((c) => c.id));
    const parts: string[] = [];
    for (const c of classCards) {
      if (!ids.has(c.id)) continue;
      for (const r of c.rules) if (r.active) parts.push(`${r.weekdaysText} ${r.startTime}`);
    }
    return parts.join('；');
  }, [data, classCards]);

  const recent = useMemo(() => {
    const since = Date.now() - 90 * 86400000;
    const r = { present: 0, leave: 0, absent: 0 };
    for (const e of ledger) {
      if (e.type !== 'consume' || e.reversed || e.reversesId || e.occurredAt < since) continue;
      if (e.attendanceStatus === 'leave') r.leave++;
      else if (e.attendanceStatus === 'absent') r.absent++;
      else if (e.attendanceStatus) r.present++;
    }
    return r;
  }, [ledger]);

  const header = (
    <PageHeader
      crumb={{ to: '/students', label: '学生' }}
      title={data ? <>{data.name}{data.enName && <> <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>{data.enName}</span></>}</> : '学生详情'}
      right={data && <>
        <button className="btn" onClick={() => setModal('leave')}>登记请假</button>
        <button className="btn" onClick={() => setModal('adjust')}>手动调整课时</button>
        <button className="btn" onClick={() => setModal('edit')}>编辑资料</button>
        <Link className="btn primary" to={`/students/${id}/recharge`}>登记充值</Link>
      </>}
    />
  );

  if (error) return <>{header}<div className="page-body"><div className="err">{error}</div></div></>;
  if (!data) return <>{header}<div className="page-body">{loading && <Loading />}</div></>;

  const s = data;
  const tone = s.balance < 0 ? 'danger' : s.balance <= threshold ? 'warn' : undefined;
  const current: PackageView | undefined = s.packages.find((p) => !p.reversed) ?? s.packages[0];
  const history = s.packages.filter((p) => p !== current);
  const hasMore = ledger.length < s.ledgerTotal;

  return (
    <>
      {header}
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* 档案卡 */}
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '18px 22px' }}>
          <Avatar name={s.name} tone={tone} size={56} />
          <div style={{ width: 178 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{s.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
              {s.classes.map((c) => (
                <span key={c.id} className="pill" style={{ height: 22, padding: '0 9px', fontSize: 11.5, background: 'var(--class-2-soft)', color: 'var(--ok-ink)' }}>{c.name}</span>
              ))}
              <span className={`pill ${s.status === 'active' ? 'neutral' : s.status === 'paused' ? 'warn' : 'danger'}`} style={{ height: 22, padding: '0 9px', fontSize: 11.5 }}>{studentStatusLabel(s.status)}</span>
            </div>
          </div>
          <div style={vline} />
          <div style={{ width: 150 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>课时余额</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
              <span className="num" style={{ fontSize: 34, fontWeight: 600, lineHeight: 1, color: balanceColor(s.balance, threshold) }}>{num(s.balance)}</span>
              {s.balance < 0 && <span style={{ fontSize: 12, color: 'var(--danger-ink)' }}>已欠 {num(-s.balance)} 课时</span>}
              {s.balance === 0 && <span style={{ fontSize: 12, color: 'var(--warn-ink)' }}>下次上课起欠</span>}
            </div>
          </div>
          <div style={vline} />
          <div style={{ width: 132 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>累计已消耗</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, lineHeight: 1 }}>{num(s.totalConsumed)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>课时</span></div>
          </div>
          <div style={vline} />
          <div style={{ width: 132 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>本月出勤</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, lineHeight: 1 }}>{s.monthAttended} / {s.monthTotal} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>次</span></div>
          </div>
          <div style={vline} />
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>入学</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, lineHeight: 1 }}>{s.enrolledOn.slice(0, 7)}</div>
          </div>
        </section>

        {/* 欠课时横幅 */}
        {s.balance < 0 && (
          <section style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--banner-danger-bg)', border: '1px solid var(--banner-danger-line)', borderRadius: 12, padding: '12px 18px' }}>
            <IconWarn size={16} style={{ color: 'var(--danger-ink)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--ink-on-danger)' }}>
              {s.owedText}{s.owedText && !/[。.]$/.test(s.owedText) ? '。' : ''}下次的课照常上，课后将欠 <span className="num">{num(-s.balance + presentHours)}</span> 课时。
            </span>
            <div style={{ flexGrow: 1 }} />
            <Link to={`/students/${id}/recharge`} className="btn sm danger" style={{ height: 32, padding: '0 16px' }}>充值并抵扣</Link>
          </section>
        )}

        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>

          {/* 课时流水 */}
          <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 20px', borderBottom: '1px solid var(--line-faint)' }}>
              <h2 style={{ fontSize: 16 }}>课时流水</h2>
              <span className="faint" style={{ fontSize: 11.5 }}>共 <span className="num">{s.ledgerTotal}</span> 条 · <span className="num">{s.undoWindowDays}</span> 天内可撤销</span>
              <div style={{ flexGrow: 1 }} />
              {KINDS.map((k) => {
                const on = k.key === kind;
                return (
                  <button
                    key={k.key} type="button" aria-pressed={on} onClick={() => setKind(k.key)}
                    style={{
                      height: 28, padding: '0 12px', borderRadius: 14, fontSize: 12, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`,
                      background: on ? 'var(--accent)' : 'var(--surface)',
                      color: on ? 'var(--nav-text-on)' : 'var(--ink-2)',
                    }}
                  >{k.label}</button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 36, padding: '0 20px', background: 'var(--surface-sunk)', fontSize: 11.5, color: 'var(--ink-3)' }}>
              <span style={col(54)}>日期</span>
              <span style={col(52)}>类型</span>
              <span style={{ flexGrow: 1, minWidth: 0 }}>说明</span>
              <span style={col(64, true)}>变动</span>
              <span style={col(58, true)}>余额</span>
              <span style={col(56, true)}>操作</span>
            </div>

            {undoErr && <div className="err" style={{ padding: '8px 20px', borderTop: '1px solid var(--line-soft)' }}>{undoErr}</div>}

            {shown.length === 0 && (
              <Empty title={ledger.length === 0 ? '还没有课时记录' : '没有这类记录'} hint={ledger.length === 0 ? '充值课包后开始点名，这里会记录每一次变动' : undefined} />
            )}

            {shown.map((e) => {
              const t = typeOf(e);
              const rowBg = e.type === 'adjust' ? 'var(--row-neutral)' : e.type === 'recharge' ? 'var(--row-ok)' : undefined;
              const desc = e.type === 'consume' && e.packageId ? `${e.reason} · 课包` : e.reason;
              const before = e.balanceAfter - e.delta;
              return (
                <div key={e.id}>
                  <div className={e.reversed ? 'strike' : ''} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 52, padding: '0 20px', borderTop: '1px solid var(--line-soft)', background: rowBg }}>
                    <span className="num" style={{ ...col(54), fontSize: 13, color: e.reversed ? undefined : 'var(--ink-2)' }}>{md(dateOf(e.occurredAt))}</span>
                    <span style={col(52)}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', height: 21, padding: '0 8px', borderRadius: 6, background: t.bg, color: t.fg, fontSize: 11, opacity: e.reversed ? 0.6 : 1 }}>{t.label}</span>
                    </span>
                    <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={desc}>{desc}</span>
                    <span className="num" style={{ ...col(64, true), fontSize: 15, color: e.reversed ? undefined : deltaColor(e.delta) }}>{num(e.delta, { sign: true })}</span>
                    <span className="num" style={{ ...col(58, true), fontSize: 14, fontWeight: 600, color: e.reversed ? undefined : balanceColor(e.balanceAfter, threshold) }}>{num(e.balanceAfter)}</span>
                    <span style={{ ...col(56, true), textDecoration: 'none' }}>
                      {e.reversed ? (
                        <span className="faint" style={{ fontSize: 12, textDecoration: 'none' }}>已冲正</span>
                      ) : e.undoable ? (
                        <button type="button" onClick={() => undo(e)} style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}>撤销</button>
                      ) : null}
                    </span>
                  </div>
                  {e.type === 'recharge' && (e.packageOffset ?? 0) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 30, padding: '0 20px', background: rowBg }}>
                      <span style={col(106)} />
                      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 11.5, color: 'var(--neutral-ink)' }}>
                        ↳ 充值前余额 <span className="num">{num(before)}</span>，其中 <span className="num">{num(e.packageOffset)}</span> 课次用于结清欠课时，实际可用 <span className="num">{num(e.balanceAfter)}</span> 课时
                      </span>
                      <span style={col(128)} />
                    </div>
                  )}
                </div>
              );
            })}

            {hasMore && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 20px', borderTop: '1px solid var(--line-soft)', background: 'var(--row-neutral)' }}>
                <span className="faint" style={{ fontSize: 11 }}>已显示 <span className="num">{ledger.length}</span> / {s.ledgerTotal} 条</span>
                <span style={{ flexGrow: 1, height: 1, background: 'var(--line-faint)' }} />
                <button type="button" onClick={loadMore} disabled={moreBusy} style={{ border: 0, background: 'transparent', padding: 0, fontSize: 11.5, color: 'var(--accent)', cursor: 'pointer' }}>
                  {moreBusy ? '加载中…' : '加载更多'}
                </button>
              </div>
            )}
          </section>

          {/* 右栏 */}
          <aside style={{ width: 306, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

            <section className="card" style={{ padding: '16px 18px' }}>
              <h2 style={h2}>当前课包</h2>
              {!current ? (
                <>
                  <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>还没有课包</div>
                  <Link to={`/students/${id}/recharge`} className="btn primary sm" style={{ marginTop: 12 }}>登记充值</Link>
                </>
              ) : (
                <PackageBlock p={current} />
              )}
              {history.length > 0 && history.map((p, i) => (
                <div key={p.id} style={{ ...kv, fontSize: 11.5, marginTop: 7 }}>
                  <span>{i === 0 ? '历史课包' : ''}</span>
                  <span className={p.reversed ? 'strike' : ''} style={kvVal}>
                    <span className="num">{p.sessions}</span> 课次 <span className="num">{yuan(p.amountCents)}</span>（<span className="num">{yuan(p.unitPriceCents)}</span> / 次）{p.reversed && ' 已冲正'}
                  </span>
                </div>
              ))}
              {s.packages.length > 0 && (
                <div style={{ ...kv, fontSize: 11.5, marginTop: 7 }}>
                  <span>累计付费</span>
                  <span className="num" style={kvVal}>{yuan(s.totalPaidCents)} / {num(s.totalRecharged)} 课次</span>
                </div>
              )}
              <p style={{ margin: '11px 0 0', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                单价由每次充值的「总金额 ÷ 课次」自动算出，逐包保存。课包不设有效期，用完后可继续上课，超出部分记为欠课时，下次充值自动抵扣。
              </p>
            </section>

            <section className="card" style={{ padding: '16px 18px' }}>
              <h2 style={h2}>上课规律</h2>
              <div style={{ ...kv, marginTop: 11 }}>
                <span>固定班级</span>
                <span style={kvVal}>{s.classes.length ? s.classes.map((c) => c.name).join(' / ') : '—'}</span>
              </div>
              <div style={{ ...kv, marginTop: 8 }}>
                <span>上课时间</span>
                <span style={kvVal}>{ruleText || '—'}</span>
              </div>
              <div style={{ ...kv, marginTop: 8 }}>
                <span>近三个月</span>
                <span style={kvVal}>出勤 <span className="num">{recent.present}</span> · 请假 <span className="num">{recent.leave}</span> · 缺勤 <span className="num">{recent.absent}</span></span>
              </div>
            </section>

            <section className="card" style={{ padding: '16px 18px' }}>
              <h2 style={h2}>联系人</h2>
              <div style={{ ...kv, marginTop: 11 }}><span>家长</span><span style={kvVal}>{s.guardianName || '—'}</span></div>
              <div style={{ ...kv, marginTop: 8 }}><span>电话</span><span className="num" style={kvVal}>{s.phone || '—'}</span></div>
              <div style={{ ...kv, marginTop: 8 }}><span>备注</span><span style={{ ...kvVal, whiteSpace: 'pre-wrap', maxWidth: 200 }}>{s.note || '—'}</span></div>
            </section>
          </aside>
        </div>
      </div>

      {modal === 'edit' && (
        <StudentFormModal student={s} classes={classCards} onClose={() => setModal(null)} onDone={() => { setModal(null); afterWrite('已保存'); }} />
      )}
      {modal === 'leave' && (
        <LeaveModal student={s} onClose={() => setModal(null)} onDone={() => { setModal(null); afterWrite('已记录请假备注'); }} />
      )}
      {modal === 'adjust' && (
        <AdjustModal student={s} onClose={() => setModal(null)} onDone={() => { setModal(null); afterWrite('已调整课时'); }} />
      )}
    </>
  );
}

/** 当前课包主体：课次、金额、进度 */
function PackageBlock({ p }: { p: PackageView }) {
  const over = Math.max(0, p.used - p.sessions);
  const total = Math.max(p.used, p.sessions, 1);
  // 超出时：主色段 = 课次占已用比例（留 2% 空隙），红色段 = 剩余
  const mainW = over > 0 ? (p.sessions / total) * 100 - 2 : (p.used / total) * 100;
  const dangerW = over > 0 ? 100 - mainW - 2 : 0;
  return (
    <>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 10 }} className={p.reversed ? 'strike' : ''}>
        课包 · <span className="num">{p.sessions}</span> 课次{p.reversed && '（已冲正）'}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5 }}>
        <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>{yuan(p.amountCents)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>÷ <span className="num">{p.sessions}</span> 课次 = <span className="num">{yuan(p.unitPriceCents)}</span> / 次</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 14 }}>
        <span>已用 <span className="num">{num(p.used)} / {p.sessions}</span></span>
        {over > 0
          ? <span style={{ color: 'var(--danger-ink)' }}>超出 <span className="num">{num(over)}</span></span>
          : <span>剩余 <span className="num">{num(p.remaining)}</span></span>}
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, background: 'var(--neutral-soft)', marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, mainW)}%`, height: 8, background: 'var(--accent)' }} />
        {over > 0 && <div style={{ width: '2%', height: 8, background: 'var(--surface)' }} />}
        {over > 0 && <div style={{ width: `${dangerW}%`, height: 8, background: 'var(--danger)' }} />}
      </div>
      <div style={{ ...kv, fontSize: 11.5, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
        <span>购买日期</span><span className="num" style={kvVal}>{p.purchasedOn}</span>
      </div>
      <div style={{ ...kv, fontSize: 11.5, marginTop: 7 }}>
        <span>有效期</span><span style={kvVal}>不限，用完为止</span>
      </div>
    </>
  );
}

/** 登记请假：只做备注，追加到 student.note */
function LeaveModal({ student, onClose, onDone }: { student: StudentDetailData; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) { setErr('请填写备注'); return; }
    setBusy(true); setErr(null);
    const line = `${todayStr()} 请假：${text.trim()}`;
    try {
      await api.updateStudent(student.id, {
        name: student.name, enName: student.enName, status: student.status, enrolledOn: student.enrolledOn,
        guardianName: student.guardianName, phone: student.phone,
        note: student.note ? `${student.note}\n${line}` : line,
      });
      onDone();
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="登记请假" sub={student.name} onClose={onClose} width={460}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>取消</button>
        <button className="btn primary" onClick={submit} disabled={busy}>保存备注</button>
      </>}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>请假在点名时标记，这里只做备注（会追加到学生备注里，不影响课时）。</div>
      <div className="field">
        <label>备注</label>
        <textarea className="input" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：下周二家长提前请假" />
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

/** 手动调整课时 */
function AdjustModal({ student, onClose, onDone }: { student: StudentDetailData; onClose: () => void; onDone: () => void }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = Number(delta);
  const valid = delta.trim() !== '' && Number.isFinite(d) && d !== 0;
  const after = valid ? student.balance + d : null;

  const submit = async () => {
    if (!valid) { setErr('变动课时不能为 0'); return; }
    if (!reason.trim()) { setErr('请填写原因'); return; }
    const amt = amount.trim() ? Number(amount) : null;
    if (amt != null && !Number.isFinite(amt)) { setErr('金额格式不对'); return; }
    setBusy(true); setErr(null);
    try {
      await api.manualAdjust({
        studentId: student.id, delta: d, reason: reason.trim(),
        amountCents: amt == null ? null : Math.round(amt * 100),
        occurredOn: date || null,
      });
      onDone();
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="手动调整课时" sub={<>{student.name} · 当前余额 <span className="num">{num(student.balance)}</span></>} onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>取消</button>
        <button className="btn primary" onClick={submit} disabled={busy}>写入调整</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="field">
          <label>变动课时 <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input num" type="number" step="0.5" autoFocus value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+1 或 −1" />
        </div>
        <div className="field">
          <label>调整后余额</label>
          <div className="input num" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-sunk)', color: after == null ? 'var(--ink-4)' : balanceColor(after, 3) }}>
            {after == null ? '—' : num(after)}
          </div>
        </div>
        <div className="field">
          <label>金额（元，选填）</label>
          <input className="input num" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如补差价、退费" />
        </div>
        <div className="field">
          <label>日期（选填，默认今天）</label>
          <DatePicker value={date} onChange={setDate} allowEmpty placeholder="默认今天" />
        </div>
      </div>
      <div className="field">
        <label>原因 <span style={{ color: 'var(--danger)' }}>*</span></label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：8-20 重复点名，回退 1 课时" />
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>正数为补回课时，负数为扣减；将写入一条「调整」流水，可在 {student.undoWindowDays} 天内撤销。</div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
