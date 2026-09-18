import { DatePicker } from '../components/pickers';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import * as api from '../lib/api';
import type { OwedMode, PlannedEntry, RechargePreview } from '../lib/api';
import { methodLabel, num, todayStr, yuan } from '../lib/format';
import { Avatar, Loading, PageHeader, useAsync, useRefresh, useToast } from '../components/ui';

// ---------- 画板里的内联样式 ----------
const label: CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 6 };
const box = (h: number): CSSProperties => ({
  display: 'flex', alignItems: 'center', height: h, padding: '0 14px',
  background: 'var(--surface-input)', border: '1px solid var(--line-ctrl)', borderRadius: 10,
});
const bigInput: CSSProperties = {
  flexGrow: 1, width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent',
  fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--ink)',
};
const h2: CSSProperties = { margin: '22px 0 12px', fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 };
const optBase: CSSProperties = { display: 'flex', alignItems: 'center', gap: 13, padding: '13px 16px', borderRadius: 11, cursor: 'pointer' };
const optOn: CSSProperties = { ...optBase, border: '1.5px solid var(--accent)', background: 'var(--accent-tint)' };
const optOff: CSSProperties = { ...optBase, border: '1px solid var(--line-ctrl)', background: 'var(--surface)' };
const rowKV: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, color: 'var(--ink-3)' };
const kvVal: CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink)' };
const sideCard: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' };
const sideH2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 };

type Tone = 'ok' | 'warn' | 'neutral';
const toneStyle: Record<Tone, { bg: string; ink: string }> = {
  ok: { bg: 'var(--ok-soft)', ink: 'var(--ok-ink)' },
  warn: { bg: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
  neutral: { bg: 'var(--neutral-soft)', ink: 'var(--neutral-ink)' },
};
interface DisplayEntry { key: string; type: string; desc: string; val: string; tone: Tone }

function parseQty(s: string): number {
  const n = parseInt(s, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}
function parseAmountCents(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) || n < 0 ? 0 : Math.round(n * 100);
}

export function Recharge() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { bump } = useRefresh();

  const student = useAsync(() => api.getStudent(id, 0, 1), [id]);
  const settings = useAsync(() => api.getSettings(), []);

  const [qty, setQty] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<OwedMode | null>(null);
  const [date, setDate] = useState(todayStr());
  const [method, setMethod] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<RechargePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 默认方式按 autoOffsetOnRecharge；默认收款方式取第一项
  useEffect(() => {
    if (!settings.data) return;
    setMode((m) => m ?? (settings.data!.hoursRule.autoOffsetOnRecharge ? 'offset' : 'cash'));
    setMethod((m) => m ?? (settings.data!.defaults.paymentMethods[0] ?? null));
  }, [settings.data]);

  const qtyN = parseQty(qty);
  const amountCents = parseAmountCents(amount);
  const effMode: OwedMode = mode ?? 'offset';

  // 单价与欠款折算：qty / amount / mode 变化后 150ms 调后端校正
  const seq = useRef(0);
  useEffect(() => {
    if (!id || qtyN <= 0 || amountCents <= 0) { setPreview(null); return; }
    const my = ++seq.current;
    const t = setTimeout(() => {
      api.previewRecharge({ studentId: id, sessions: qtyN, amountCents, mode: effMode })
        .then((p) => { if (seq.current === my) setPreview(p); })
        .catch(() => { if (seq.current === my) setPreview(null); });
    }, 150);
    return () => clearTimeout(t);
  }, [id, qtyN, amountCents, effMode]);

  // 后端返回的是否对应当前输入（否则先用画板公式即时算）
  const fresh = !!preview && qtyN > 0 && amountCents > 0;
  const balance = preview?.balance ?? student.data?.balance ?? 0;
  const owed = preview?.owedHours ?? (balance < 0 ? -balance : 0);
  const owedUnit = preview?.owedUnitPriceCents ?? student.data?.owedUnitPriceCents ?? 0;
  const owedCents = preview?.owedCents ?? Math.round(owed * owedUnit);
  const hasOwed = owed > 0;

  const unitCents = fresh ? preview!.plan.unitPriceCents : qtyN > 0 ? Math.round(amountCents / qtyN) : 0;
  const unitText = qtyN > 0 && amountCents > 0 ? `${yuan(unitCents)} / 次` : '—';
  const isOffset = effMode === 'offset';
  const offsetApplied = hasOwed && isOffset ? (fresh ? preview!.plan.offsetSessions : Math.min(owed, qtyN)) : 0;
  const offsetUsable = qtyN - offsetApplied;
  const afterBalance = fresh ? preview!.plan.balanceAfter : hasOwed && isOffset ? balance + qtyN : qtyN + Math.max(0, balance);
  const receivedCents = fresh ? preview!.plan.receivedCents : hasOwed && !isOffset ? amountCents + owedCents : amountCents;
  const payText = yuan(receivedCents);

  const entries = useMemo<DisplayEntry[]>(() => {
    const list: DisplayEntry[] = [];
    const push = (e: PlannedEntry, i: number) => {
      list.push({
        key: `${e.entryType}-${i}`,
        type: e.entryType === 'recharge' ? '充值' : '补缴',
        desc: e.reason,
        val: num(e.delta, { sign: true }),
        tone: e.entryType === 'recharge' ? 'ok' : 'warn',
      });
      if (e.entryType === 'recharge' && isOffset && offsetApplied > 0) {
        list.push({
          key: 'offset', type: '抵扣', desc: `结清此前欠课时，实际可用 ${num(offsetUsable)} 课时`,
          val: num(-offsetApplied), tone: 'neutral',
        });
      }
    };
    if (fresh) {
      preview!.plan.entries.forEach(push);
    } else {
      const rechargeE: PlannedEntry = { entryType: 'recharge', delta: qtyN, balanceAfter: afterBalance, amountCents, reason: `课包 ${qtyN} 课次 · ${yuan(amountCents)}` };
      if (hasOwed && !isOffset) push({ entryType: 'adjust', delta: owed, balanceAfter: 0, amountCents: owedCents, reason: `结清欠 ${num(owed)} 课时 · ${yuan(owedCents)}` }, 0);
      push(rechargeE, 1);
    }
    return list;
  }, [fresh, preview, isOffset, offsetApplied, offsetUsable, qtyN, amountCents, afterBalance, hasOwed, owed, owedCents]);

  const submit = async () => {
    const q = parseInt(qty, 10);
    if (!Number.isInteger(q) || q <= 0 || String(q) !== qty.trim()) { setErr('课次必须是大于 0 的整数'); return; }
    if (amountCents <= 0) { setErr('金额必须大于 0'); return; }
    setErr(null); setBusy(true);
    try {
      await api.recharge({ studentId: id, sessions: q, amountCents, purchasedOn: date || null, method, mode: hasOwed ? effMode : null, note: note.trim() || null });
      bump();
      toast(`已登记充值 ${payText}`, 'ok');
      navigate(`/students/${id}`);
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const s = student.data;
  const presets = settings.data?.defaults.packagePresets ?? [];
  const methods = settings.data?.defaults.paymentMethods ?? [];
  const packages = s?.packages ?? [];
  const totalSessions = packages.filter((p) => !p.reversed).reduce((a, p) => a + p.sessions, 0);

  return (
    <>
      <PageHeader crumb={{ to: `/students/${id}`, label: s?.name ?? '学生' }} title="登记充值"
        right={<span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>充值只记录课次和总金额，单价由系统折算</span>} />
      <div className="page-body">
        {student.error && <div className="err">{student.error}</div>}
        {!s && student.loading && <Loading />}
        {s && (
          <div style={{ display: 'flex', gap: 20, minHeight: '100%' }}>
            <section className="card" style={{ width: 700, flexShrink: 0, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
              {/* 学生 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, borderBottom: '1px solid var(--line-soft)' }}>
                <Avatar name={s.name} size={44} tone={s.balance < 0 ? 'danger' : undefined} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>{s.classes.length ? s.classes.map((c) => c.name).join(' · ') : '未加入班级'}</div>
                </div>
                <div style={{ flexGrow: 1 }} />
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px', borderRadius: 15, fontSize: 12.5,
                  background: s.balance < 0 ? 'var(--danger-soft)' : 'var(--neutral-soft)', color: s.balance < 0 ? 'var(--danger-ink)' : 'var(--neutral-ink)',
                }}>
                  当前余额<span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{num(s.balance)}</span>课时
                </span>
              </div>

              {/* 充值内容 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 12px', flexWrap: 'wrap' }}>
                <h2 style={{ ...h2, margin: 0 }}>充值内容</h2>
                <div style={{ flexGrow: 1 }} />
                {presets.map((p, i) => {
                  const on = qtyN === p.sessions && amountCents === p.amountCents;
                  return (
                    <button key={i} type="button" className={`chip ${on ? 'on' : ''}`} style={{ height: 26, padding: '0 10px', fontSize: 12 }}
                      onClick={() => { setQty(String(p.sessions)); setAmount(String(p.amountCents / 100)); }}>
                      <span className="num">{p.sessions}</span> 课次 <span className="num">{yuan(p.amountCents)}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ flexGrow: 1 }}>
                  <span style={label}>课次</span>
                  <span style={box(42)}>
                    <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={bigInput} />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>课次</span>
                  </span>
                </label>
                <label style={{ flexGrow: 1 }}>
                  <span style={label}>总金额</span>
                  <span style={{ ...box(42), gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, color: 'var(--ink-3)' }}>¥</span>
                    <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={bigInput} />
                  </span>
                </label>
                <div style={{ width: 176, flexShrink: 0 }}>
                  <span style={label}>折合单价（自动）</span>
                  <span className="num" style={{ display: 'flex', alignItems: 'center', height: 42, padding: '0 14px', background: 'var(--surface-soft)', border: '1px dashed var(--dashed-soft)', borderRadius: 10, fontSize: 19, fontWeight: 600, color: 'var(--ink-2)' }}>
                    {unitText}
                  </span>
                </div>
              </div>

              {/* 欠课时处理：只在余额 < 0 时显示 */}
              {hasOwed && (
                <>
                  <h2 style={{ ...h2, margin: '22px 0 6px' }}>欠课时处理</h2>
                  <p style={{ margin: '0 0 11px', fontSize: 11.5, color: 'var(--ink-3)' }}>
                    {owedUnit > 0
                      ? <>{s.name}此前欠 <span className="num">{num(owed)}</span> 课时，按上一课包 <span className="num">{yuan(owedUnit)}</span> / 次折算为 <span className="num">{yuan(owedCents)}</span>。</>
                      : <>{s.name}此前欠 <span className="num">{num(owed)}</span> 课时，尚无课包记录，欠款按 <span className="num">¥0</span> 折算。</>}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={isOffset ? optOn : optOff}>
                      <input type="radio" name="owedmode" checked={isOffset} onChange={() => setMode('offset')} style={{ width: 16, height: 16, margin: 0, accentColor: 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ flexGrow: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>从本次充值中抵扣</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>
                          充值 {num(qtyN)} 课次，先抵扣欠的 {num(Math.min(owed, qtyN))} 课时，只收本次课包的钱
                        </span>
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span className="num" style={{ display: 'block', fontSize: 19, fontWeight: 600 }}>{num(qtyN - Math.min(owed, qtyN))} 课时</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)' }}>充值后可用</span>
                      </span>
                    </label>
                    <label style={isOffset ? optOff : optOn}>
                      <input type="radio" name="owedmode" checked={!isOffset} onChange={() => setMode('cash')} style={{ width: 16, height: 16, margin: 0, accentColor: 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ flexGrow: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>欠款另行补缴，课次不抵扣</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>
                          家长另付 {yuan(owedCents)} 结清欠款，本次 {num(qtyN)} 课次全部保留
                        </span>
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span className="num" style={{ display: 'block', fontSize: 19, fontWeight: 600 }}>{num(qtyN)} 课时</span>
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)' }}>充值后可用</span>
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* 收款信息 */}
              <h2 style={h2}>收款信息</h2>
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ width: 200, flexShrink: 0 }}>
                  <span style={label}>收款日期</span>
                  <DatePicker value={date} onChange={setDate} height={40} />
                </label>
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <span style={label}>收款方式</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {methods.map((m) => {
                      const on = m === method;
                      return (
                        <button key={m} type="button" onClick={() => setMethod(m)} style={{
                          height: 40, padding: '0 16px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`,
                          background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--nav-text-on)' : 'var(--ink-2)',
                        }}>{methodLabel(m)}</button>
                      );
                    })}
                    {methods.length === 0 && <span className="muted" style={{ fontSize: 12, lineHeight: '40px' }}>未配置收款方式，可在设置里添加</span>}
                  </div>
                </div>
              </div>
              <label style={{ display: 'block', marginTop: 14 }}>
                <span style={label}>备注（选填）</span>
                <span style={box(40)}>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：秋季续课，家长要求开收据"
                    style={{ flexGrow: 1, width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 13, color: 'var(--ink)' }} />
                </span>
              </label>

              <div style={{ flexGrow: 1, minHeight: 18 }} />

              {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>确认后会写入课时流水，可在学生详情里撤销</span>
                <div style={{ flexGrow: 1 }} />
                <Link to={`/students/${id}`} className="btn" style={{ height: 42, padding: '0 20px', borderRadius: 10, fontSize: 13.5 }}>取消</Link>
                <button type="button" className="btn primary" disabled={busy} onClick={submit} style={{ height: 42, padding: '0 26px', borderRadius: 10, fontSize: 14 }}>
                  确认充值 {payText}
                </button>
              </div>
            </section>

            <aside style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 本次结算 */}
              <section style={sideCard}>
                <h2 style={sideH2}>本次结算</h2>
                <div style={{ ...rowKV, marginTop: 14 }}><span>充值课次</span><span style={kvVal}>{num(qtyN)} 课次</span></div>
                <div style={{ ...rowKV, marginTop: 9 }}><span>折合单价</span><span style={kvVal}>{unitText}</span></div>
                <div style={{ ...rowKV, marginTop: 9, color: undefined }}>
                  <span style={{ color: 'var(--ink-3)' }}>抵扣此前欠课时</span>
                  {offsetApplied > 0
                    ? <span className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-deep)' }}>{num(-offsetApplied)} 课时</span>
                    : <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>不抵扣</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 15, paddingTop: 15, borderTop: '1px solid var(--line-soft)' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>充值后余额</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 3 }}>
                      <span className="num" style={{ fontSize: 36, fontWeight: 600, color: afterBalance < 0 ? 'var(--danger)' : 'var(--ok-ink)', lineHeight: 1 }}>{num(afterBalance)}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>课时</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>实收</div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, lineHeight: 1 }}>{payText}</div>
                  </div>
                </div>
              </section>

              {/* 将写入的流水 */}
              <section style={sideCard}>
                <h2 style={sideH2}>将写入的流水</h2>
                <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--ink-3)' }}>每笔都可在学生详情里查到并撤销</p>
                {entries.map((e) => (
                  <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderTop: '1px solid var(--line-soft)', marginTop: 11 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', height: 21, padding: '0 8px', borderRadius: 6, fontSize: 11, flexShrink: 0, background: toneStyle[e.tone].bg, color: toneStyle[e.tone].ink }}>{e.type}</span>
                    <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-2)' }}>{e.desc}</span>
                    <span className="num" style={{ fontSize: 14, fontWeight: 600, flexShrink: 0, color: toneStyle[e.tone].ink }}>{e.val}</span>
                  </div>
                ))}
              </section>

              {/* 历史课包 */}
              <section style={sideCard}>
                <h2 style={sideH2}>历史课包</h2>
                {packages.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>尚无课包记录</div>}
                {packages.map((p, i) => (
                  <div key={p.id} className={p.reversed ? 'strike' : ''} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: p.reversed ? undefined : 'var(--ink-3)', marginTop: i === 0 ? 12 : 8 }}>
                    <span><span className="num">{p.purchasedOn}</span> · <span className="num">{p.sessions}</span> 课次{p.offsetSessions > 0 && <>（抵扣 <span className="num">{p.offsetSessions}</span>）</>}</span>
                    <span className="num" style={{ color: p.reversed ? undefined : 'var(--ink)' }}>{yuan(p.amountCents)} · {yuan(p.unitPriceCents)} / 次</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)', marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                  <span>累计付费</span>
                  <span className="num" style={{ color: 'var(--ink)' }}>{yuan(s.totalPaidCents)} / {num(totalSessions)} 课次</span>
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
