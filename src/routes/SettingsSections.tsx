import { TimePicker } from '../components/pickers';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api';
import type { AllSettings, BackupFile, HoursRule, InvariantReport, PackagePreset } from '../lib/api';
import { Loading, Modal, Stepper, Switch, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';
import { IconClose } from '../components/icons';
import { bytes, dt, methodLabel, num, todayStr, yuan } from '../lib/format';
import type { Patch } from './Settings';

interface SP { d: AllSettings; patch: Patch; reload?: () => void }

// ---------- 通用小件 ----------
const H2: React.CSSProperties = { fontSize: 17 };
const H2Side: React.CSSProperties = { fontSize: 16 };
const SUB: React.CSSProperties = { margin: '5px 0 0', fontSize: 11.5, color: 'var(--ink-3)' };
const LABEL: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 6 };
const KV: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, color: 'var(--ink-3)' };
const NOTE: React.CSSProperties = { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 };
const BIG: React.CSSProperties = { fontSize: 17, fontWeight: 600, color: 'var(--ink)' };

function Row({ h = 56, top, children, style }: { h?: number; top?: boolean; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, height: h, borderBottom: top ? undefined : '1px solid var(--line-soft)', borderTop: top ? '1px solid var(--line-soft)' : undefined, ...style }}>
      {children}
    </div>
  );
}
function Text({ t, s, onClick }: { t: ReactNode; s?: ReactNode; onClick?: () => void }) {
  return (
    <span style={{ flexGrow: 1, minWidth: 0, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <span style={{ display: 'block', fontSize: 13.5 }}>{t}</span>
      {s && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{s}</span>}
    </span>
  );
}
const Unit = ({ t }: { t: string }) => <span style={{ width: 36, textAlign: 'right', fontSize: 12, color: 'var(--ink-3)', flexShrink: 0 }}>{t}</span>;

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <span style={{ width: 112, display: 'inline-block' }}><TimePicker value={value} onChange={onChange} height={34} minHour={0} maxHour={23} /></span>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card" style={{ padding: '18px 20px', flexShrink: 0 }}><h2 style={H2Side}>{title}</h2>{children}</section>;
}

/** 可删除的标签 + 内联添加 */
function TagList({ items, label, onRemove, onAdd, addText, placeholder }: {
  items: string[]; label?: (s: string) => string; onRemove: (i: number) => void; onAdd: (s: string) => void; addText: string; placeholder?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) ref.current?.focus(); }, [adding]);
  const commit = () => { const t = v.trim(); if (t) onAdd(t); setV(''); setAdding(false); };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {items.map((s, i) => (
        <span key={`${s}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', border: '1px solid var(--line-ctrl)', borderRadius: 9, background: 'var(--surface-input)', fontSize: 12.5 }}>
          {label ? label(s) : s}
          <button type="button" aria-label={`删除 ${s}`} onClick={() => onRemove(i)} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--ink-4)', display: 'flex' }}><IconClose size={12} /></button>
        </span>
      ))}
      {adding ? (
        <input ref={ref} className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(''); setAdding(false); } }}
          onBlur={commit} style={{ width: 140, height: 34 }} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ height: 34, padding: '0 14px', border: '1px dashed var(--dashed)', borderRadius: 9, background: 'transparent', color: 'var(--accent-deep)', fontSize: 12.5, cursor: 'pointer' }}>{addText}</button>
      )}
    </div>
  );
}

// =============== rules ===============
const STATUS_ROWS: { key: keyof Pick<HoursRule, 'present' | 'late' | 'leave' | 'absent'>; label: string; hint?: string; color: string }[] = [
  { key: 'present', label: '出勤', color: 'var(--ok)' },
  { key: 'late', label: '迟到', color: 'var(--warn)' },
  { key: 'leave', label: '请假', hint: '家长提前说过', color: 'var(--leave-line)' },
  { key: 'absent', label: '缺勤', hint: '没来也没说', color: 'var(--danger)' },
];

function PriceOpt({ on, text, onPick }: { on: boolean; text: string; onPick: () => void }) {
  return (
    <label className={`opt ${on ? 'on' : ''}`} style={{ flexGrow: 1, gap: 9, padding: '11px 13px', borderRadius: 10, position: 'relative' }}>
      <input type="radio" name="pricemode" checked={on} onChange={onPick} />
      <span className="radio" />
      <span style={{ fontSize: 12.5 }}>{text}</span>
    </label>
  );
}

export function RulesSection({ d, patch }: SP) {
  const r = d.hoursRule;
  const set = (p: Partial<HoursRule>) => patch('hoursRule', p);
  return (
    <div>
      <h2 style={H2}>各状态扣多少课时</h2>
      <p style={SUB}>点名时每个学生选一个状态，按这里的设置扣减。</p>
      {STATUS_ROWS.map((s) => (
        <Row key={s.key} h={50} style={{ gap: 0 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color, flexShrink: 0 }} />
          <span style={{ marginLeft: 11, fontSize: 13.5 }}>{s.label}</span>
          {s.hint && <span style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)' }}>{s.hint}</span>}
          <div style={{ flexGrow: 1 }} />
          <Stepper value={r[s.key]} min={0} max={4} onChange={(v) => set({ [s.key]: v })} format={num} />
          <Unit t="课时" />
        </Row>
      ))}

      <h2 style={{ ...H2, marginTop: 22 }}>欠课时与充值抵扣</h2>
      <Row h={52} style={{ marginTop: 4 }}>
        <Switch on={r.allowNegative} onChange={(v) => set({ allowNegative: v })} label="余额不足也能点名" />
        <Text t="余额不足也能点名，记为欠课时" s="关掉后，余额为 0 的学生点名时会被拦下" onClick={() => set({ allowNegative: !r.allowNegative })} />
      </Row>
      <Row h={52}>
        <Switch on={r.autoOffsetOnRecharge} onChange={(v) => set({ autoOffsetOnRecharge: v })} label="充值时默认抵扣欠课时" />
        <Text t="充值时默认抵扣欠课时" s="登记充值时预选「从本次充值中抵扣」，仍可逐笔改" onClick={() => set({ autoOffsetOnRecharge: !r.autoOffsetOnRecharge })} />
      </Row>

      <div style={{ padding: '14px 0 4px' }}>
        <div style={{ fontSize: 13.5 }}>欠款折算单价</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <PriceOpt on={r.owedPriceMode === 'package'} text="按欠课时所属课包的单价" onPick={() => set({ owedPriceMode: 'package' })} />
          <PriceOpt on={r.owedPriceMode === 'latest'} text="按最近一次充值的单价" onPick={() => set({ owedPriceMode: 'latest' })} />
        </div>
      </div>

      <Row h={52} top style={{ marginTop: 8, gap: 0 }}>
        <Text t="已确认的点名可撤销时限" s="超过时限只能用「手动调整」冲正，留痕更清楚" />
        <Stepper value={r.undoWindowDays} min={0} max={90} onChange={(v) => set({ undoWindowDays: v })} />
        <Unit t="天" />
      </Row>
    </div>
  );
}

/** 与后端 ruleSentence 相同的拼装逻辑 */
export function ruleSentence(r: HoursRule): string {
  const parts = [
    r.present > 0 ? `出勤扣 ${num(r.present)} 课时` : '出勤不扣',
    r.late > 0 ? `迟到扣 ${num(r.late)} 课时` : '迟到不扣',
    r.leave > 0 ? `请假扣 ${num(r.leave)} 课时` : '请假不扣',
    r.absent > 0 ? `缺勤扣 ${num(r.absent)} 课时` : '缺勤不扣',
  ];
  let s = `扣课时规则：${parts.join('、')}。`;
  s += r.allowNegative ? '余额不足照常点名，不足的部分记为欠课时。' : '余额不足的学生无法点名，需先充值。';
  s += r.autoOffsetOnRecharge ? '充值时默认抵扣欠课时。' : '充值不自动抵扣欠课时。';
  return s;
}

export function RulesPreview({ d }: { d: AllSettings }) {
  const r = d.hoursRule;
  // 画板例子：Movers B 班 9 人，8 人出勤 1 人请假；林小满余额 −2
  const total = 8 * r.present + 1 * r.leave;
  const lilyAfter = -2 - r.present;
  let note: string;
  if (!r.allowNegative) note = '林小满余额为负，按当前设置今天会被拦下，需要先充值才能点名。';
  else if (r.present === 0) note = '出勤不扣课时，课包就只剩计次意义，报表里的课消收入会归零 —— 确认这是你想要的。';
  else note = `林小满出勤后变成 ${num(lilyAfter)}，欠的课时会一直挂着，下次充值时${r.autoOffsetOnRecharge ? '自动抵扣。' : '需要手动选择是否抵扣。'}`;
  return (
    <>
      <Card title="规则预览">
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink-3)' }}>点名界面顶部会显示这句话</p>
        <div style={{ marginTop: 12, padding: '13px 15px', borderRadius: 10, background: 'var(--warn-soft)', fontSize: 12.5, color: 'var(--ink-on-warn)', lineHeight: 1.7 }}>{ruleSentence(r)}</div>
      </Card>
      <Card title="按当前设置试算">
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink-3)' }}>以 Movers B 班 9 人、1 人请假为例</p>
        <div style={{ ...KV, marginTop: 13 }}><span>本次共扣</span><span className="num" style={BIG}>{num(total)} 课时</span></div>
        <div style={{ ...KV, marginTop: 9 }}><span>林小满（余额 −2）</span><span className="num" style={{ ...BIG, color: 'var(--danger)' }}>{num(lilyAfter)} 课时</span></div>
        <div style={NOTE}>{note}</div>
      </Card>
    </>
  );
}

// =============== alerts ===============
const CHANNELS = [
  { key: 'desktop', label: '桌面通知' },
  { key: 'badge', label: '应用内角标' },
  { key: 'email', label: '邮件摘要', disabled: true },
];

export function AlertsSection({ d, patch }: SP) {
  const a = d.alerts;
  const set = (p: Partial<AllSettings['alerts']>) => patch('alerts', p);
  const toggleChannel = (k: string) => set({ channels: a.channels.includes(k) ? a.channels.filter((c) => c !== k) : [...a.channels, k] });
  return (
    <div>
      <h2 style={H2}>什么时候提醒你</h2>
      <p style={SUB}>提醒只出现在应用里和桌面通知，不会自动发给家长。</p>

      <Row style={{ marginTop: 6, gap: 0 }}>
        <Text t="余额预警线" s="剩余不超过这个数，学生在列表和今日页标黄" />
        <Stepper value={a.lowBalanceThreshold} min={0} max={20} onChange={(v) => set({ lowBalanceThreshold: v })} />
        <Unit t="课时" />
      </Row>
      <Row style={{ gap: 0 }}>
        <Text t="欠课时到这个数就在点名时提示" s="提示而已，不拦你点名，方便当面跟家长说一声" />
        <Stepper value={a.owedAlertThreshold} min={1} max={20} onChange={(v) => set({ owedAlertThreshold: v })} />
        <Unit t="课时" />
      </Row>
      <Row>
        <Switch on={a.dailyDigest} onChange={(v) => set({ dailyDigest: v })} label="每天早上推送今日课程" />
        <Text t="每天早上推送今日课程" s={`${a.dailyDigestAt} 提醒今天几节课、谁余额不足`} onClick={() => set({ dailyDigest: !a.dailyDigest })} />
        <TimeInput value={a.dailyDigestAt} onChange={(v) => set({ dailyDigestAt: v })} />
      </Row>
      <Row style={{ gap: 0 }}>
        <Text t="课表快排完时提醒生成" s="已排的课次剩不到这么多天，提醒你去排课" />
        <Stepper value={a.scheduleLeadDays} min={1} max={30} onChange={(v) => set({ scheduleLeadDays: v })} />
        <Unit t="天" />
      </Row>

      <div style={{ padding: '16px 0 4px' }}>
        <div style={{ fontSize: 13.5 }}>提醒方式</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          {CHANNELS.map((c) => {
            const on = a.channels.includes(c.key);
            return (
              <button key={c.key} type="button" disabled={c.disabled} aria-pressed={on} onClick={() => toggleChannel(c.key)} style={{
                height: 36, padding: '0 16px', borderRadius: 9, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--line-ctrl)'}`, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--nav-text-on)' : 'var(--ink-2)',
              }}>{c.label}</button>
            );
          })}
          <span className="pill neutral">邮件暂不支持</span>
        </div>
      </div>
    </div>
  );
}

export function AlertsPreview({ d }: { d: AllSettings }) {
  const a = d.alerts;
  const today = useAsync(() => api.getToday(), []);
  const students = useAsync(() => api.listStudents('all'), []);
  const rows = students.data?.rows ?? [];
  const warnCount = rows.filter((s) => s.balance <= a.lowBalanceThreshold).length;
  const owedCount = rows.filter((s) => s.balance < 0).length;

  let notify: string;
  if (!a.dailyDigest) notify = '已关闭每日推送，只在应用内显示角标。';
  else if (!today.data) notify = '…';
  else {
    const ss = today.data.sessions;
    const first = ss[0];
    notify = ss.length === 0
      ? `今天没有排课。${warnCount} 人余额不足，${owedCount} 人已欠课时。`
      : `今天 ${ss.length} 节课，第一节 ${first.startTime} ${first.className}。${warnCount} 人余额不足，${owedCount} 人已欠课时。`;
  }
  return (
    <>
      <Card title="通知长这样">
        <div style={{ marginTop: 12, padding: '13px 15px', borderRadius: 12, background: 'var(--surface-soft)', border: '1px solid var(--line-ctrl)' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{d.org.name || '[机构名称]'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 5, lineHeight: 1.6 }}>{notify}</div>
          <div className="num" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 7 }}>今天 {a.dailyDigestAt}</div>
        </div>
      </Card>
      <Card title="按当前预警线">
        <div style={{ ...KV, marginTop: 12 }}><span>会被标黄的学生</span><span className="num" style={BIG}>{students.data ? `${warnCount} 人` : '—'}</span></div>
        <div style={{ ...KV, marginTop: 9 }}><span>已欠课时的学生</span><span className="num" style={{ ...BIG, color: 'var(--danger)' }}>{students.data ? `${owedCount} 人` : '—'}</span></div>
        <div style={NOTE}>预警线调高会让更多人进名单，也更容易变成没人看的红点。{a.lowBalanceThreshold > 0 && `${a.lowBalanceThreshold} 课时按每周两节算大约够上 ${num(a.lowBalanceThreshold / 2)} 周。`}</div>
      </Card>
    </>
  );
}

// =============== packs ===============
const METHOD_KEYS: Record<string, string> = { 微信: 'wechat', 支付宝: 'alipay', 现金: 'cash', 转账: 'transfer' };
const unitCents = (p: PackagePreset) => (p.sessions > 0 ? Math.round(p.amountCents / p.sessions) : 0);

export function PacksSection({ d, patch }: SP) {
  const f = d.defaults;
  const set = (p: Partial<AllSettings['defaults']>) => patch('defaults', p);
  const setPreset = (i: number, p: Partial<PackagePreset>) => set({ packagePresets: f.packagePresets.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const roomOptions = f.defaultRoom && !f.rooms.includes(f.defaultRoom) ? [f.defaultRoom, ...f.rooms] : f.rooms;
  const numBox: React.CSSProperties = { display: 'flex', alignItems: 'center', height: 38, padding: '0 14px', border: '1px solid var(--line-ctrl)', borderRadius: 9, background: 'var(--surface-input)', fontFamily: 'var(--font-display)', fontSize: 15 };
  const bare: React.CSSProperties = { width: 56, border: 0, outline: 0, background: 'transparent', fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink)', textAlign: 'right' };
  return (
    <div>
      <h2 style={H2}>新建班级的默认值</h2>
      <p style={SUB}>只影响以后新建的班级，现有班级各自保留自己的设置。</p>

      <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
        <div style={{ flexGrow: 1 }}>
          <div style={LABEL}>人数上限</div>
          <Stepper value={f.classCapacity} min={2} max={30} onChange={(v) => set({ classCapacity: v })} />
        </div>
        <div style={{ flexGrow: 1 }}>
          <div style={LABEL}>单次时长</div>
          <span style={{ ...numBox, width: 128 }}>
            <input type="number" min={15} max={300} step={5} value={f.durationMin} onChange={(e) => set({ durationMin: Math.max(0, Number(e.target.value) || 0) })} style={{ ...bare, textAlign: 'left', flexGrow: 1, width: 0 }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-3)' }}>分钟</span>
          </span>
        </div>
        <div style={{ flexGrow: 1 }}>
          <div style={LABEL}>默认教室</div>
          <select className="input" value={f.defaultRoom} onChange={(e) => set({ defaultRoom: e.target.value })} style={{ height: 38, fontSize: 13.5 }}>
            {roomOptions.length === 0 && <option value="">（还没有教室）</option>}
            {roomOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: '18px 0 0' }}>
        <div style={{ fontSize: 13.5 }}>教室</div>
        <TagList items={f.rooms} addText="＋ 添加教室" placeholder="如 C 教室"
          onRemove={(i) => set({ rooms: f.rooms.filter((_, j) => j !== i) })}
          onAdd={(s) => { if (!f.rooms.includes(s)) set({ rooms: [...f.rooms, s], defaultRoom: f.defaultRoom || s }); }} />
      </div>

      <h2 style={{ ...H2, marginTop: 24 }}>课包预设</h2>
      <p style={SUB}>登记充值时一键填入课次和金额。单价仍由「总金额 ÷ 课次」现算，预设只是省打字。</p>
      {f.packagePresets.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 46, borderBottom: '1px solid var(--line-soft)', marginTop: i === 0 ? 8 : 0 }}>
          <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={1} step={1} value={p.sessions} onChange={(e) => setPreset(i, { sessions: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ ...bare, width: 48, textAlign: 'right', borderBottom: '1px solid var(--line-ctrl)' }} />
            课次
          </span>
          <span className="num" style={{ width: 110, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, fontSize: 14 }}>
            ¥<input type="number" min={0} step={10} value={p.amountCents / 100} onChange={(e) => setPreset(i, { amountCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })} style={{ ...bare, width: 72, fontSize: 14, borderBottom: '1px solid var(--line-ctrl)' }} />
          </span>
          <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: 'var(--ink-3)' }}>折合 <span className="num">{p.sessions > 0 ? yuan(unitCents(p)) : '—'}</span></span>
          <button type="button" onClick={() => set({ packagePresets: f.packagePresets.filter((_, j) => j !== i) })} style={{ width: 40, textAlign: 'right', fontSize: 12, color: 'var(--accent)', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}>删除</button>
        </div>
      ))}
      {f.packagePresets.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '12px 0 0' }}>还没有预设，充值时需手填课次和金额</div>}
      <button type="button" onClick={() => set({ packagePresets: [...f.packagePresets, { sessions: 10, amountCents: 0 }] })}
        style={{ height: 36, padding: '0 14px', marginTop: 12, border: '1px dashed var(--dashed)', borderRadius: 9, background: 'transparent', color: 'var(--accent-deep)', fontSize: 12.5, cursor: 'pointer' }}>＋ 添加预设</button>

      <div style={{ padding: '20px 0 0' }}>
        <div style={{ fontSize: 13.5 }}>收款方式</div>
        <TagList items={f.paymentMethods} label={methodLabel} addText="＋ 添加" placeholder="如 刷卡"
          onRemove={(i) => set({ paymentMethods: f.paymentMethods.filter((_, j) => j !== i) })}
          onAdd={(s) => { const k = METHOD_KEYS[s] ?? s; if (!f.paymentMethods.includes(k)) set({ paymentMethods: [...f.paymentMethods, k] }); }} />
      </div>
    </div>
  );
}

export function PacksPreview({ d }: { d: AllSettings }) {
  const classes = useAsync(() => api.listClasses(), []);
  const f = d.defaults;
  const units = f.packagePresets.filter((p) => p.sessions > 0).map(unitCents);
  const range = units.length === 0 ? '—' : units.length === 1 || Math.min(...units) === Math.max(...units) ? yuan(units[0]) : `${yuan(Math.min(...units))} – ${yuan(Math.max(...units))}`;
  const rooms = f.rooms.map((r) => r.replace(/\s*教室$/, '')).join(' / ') || '—';
  return (
    <>
      <Card title="关于预设">
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>预设只是充值时的快捷填充。你随时可以在充值界面改掉课次或金额，单价按当次实际填的两个数现算，逐包保存。</p>
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>所以同一个学生不同时期买的课包可以是不同单价，报表里的班级均价是加权算出来的。</p>
      </Card>
      <Card title="当前在用">
        <div style={{ ...KV, marginTop: 12 }}><span>在读班级</span><span className="num" style={{ color: 'var(--ink)' }}>{classes.data ? `${classes.data.cards.length} 个` : '—'}</span></div>
        <div style={{ ...KV, marginTop: 9 }}><span>教室</span><span style={{ color: 'var(--ink)' }}>{rooms}</span></div>
        <div style={{ ...KV, marginTop: 9 }}><span>在用单价区间</span><span className="num" style={{ color: 'var(--ink)' }}>{range}</span></div>
      </Card>
    </>
  );
}

// =============== org ===============
function OrgInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: 'block', flexGrow: 1, minWidth: 0 }}>
      <span style={{ display: 'block', ...LABEL }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 14px', background: 'var(--surface-input)', border: '1px solid var(--line-ctrl)', borderRadius: 10 }}>
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ flexGrow: 1, width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, color: 'var(--ink)' }} />
      </span>
    </label>
  );
}

export function OrgSection({ d, patch }: SP) {
  const o = d.org;
  const set = (p: Partial<AllSettings['org']>) => patch('org', p);
  return (
    <div>
      <h2 style={H2}>机构信息</h2>
      <p style={SUB}>用在侧边栏、导出的报表和给家长的收据上。</p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ width: 84, flexShrink: 0 }}>
          <div style={LABEL}>标志</div>
          <img src="/logo.jpg" alt="机构标志" width={84} height={84} draggable={false} style={{ display: 'block', borderRadius: 16, objectFit: 'cover', border: '1px solid var(--line)' }} />
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 4, textAlign: 'center' }}>内置标志</div>
        </div>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <OrgInput label="机构名称" value={o.name} placeholder="[机构名称]" onChange={(v) => set({ name: v })} />
          <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
            <OrgInput label="主理人" value={o.owner} placeholder="[你的名字]" onChange={(v) => set({ owner: v })} />
            <OrgInput label="联系电话" value={o.phone} placeholder="[联系电话]" onChange={(v) => set({ phone: v })} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}><OrgInput label="上课地址" value={o.address} placeholder="[上课地址]" onChange={(v) => set({ address: v })} /></div>

      <h2 style={{ ...H2, marginTop: 24 }}>收据</h2>
      <div style={{ marginTop: 12 }}><OrgInput label="收据抬头" value={o.receiptTitle} placeholder="[机构名称] 课时费收据" onChange={(v) => set({ receiptTitle: v })} /></div>
      <div style={{ marginTop: 12 }}><OrgInput label="收据脚注（选填）" value={o.receiptFooter} placeholder="例如：课包不设有效期，用完为止" onChange={(v) => set({ receiptFooter: v })} /></div>
    </div>
  );
}

export function OrgPreview({ d }: { d: AllSettings }) {
  const o = d.org;
  const orgName = o.name || '[机构名称]';
  const title = (o.receiptTitle || '[机构名称] 课时费收据').replace('[机构名称]', orgName);
  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--ink-3)' };
  const hr = <div style={{ height: 1, background: 'var(--line-mid)', margin: '12px 0' }} />;
  return (
    <Card title="收据预览">
      <div style={{ marginTop: 12, padding: 16, borderRadius: 10, background: 'var(--surface-input)', border: '1px solid var(--line)' }}>
        <img src="/logo.jpg" alt="" width={40} height={40} draggable={false} style={{ display: 'block', margin: '0 auto 8px', borderRadius: '50%', objectFit: 'cover' }} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>{title}</div>
        {hr}
        <div style={line}><span>学生</span><span style={{ color: 'var(--ink)' }}>林小满</span></div>
        <div style={{ ...line, marginTop: 7 }}><span>课次</span><span className="num" style={{ color: 'var(--ink)' }}>10 课次</span></div>
        <div style={{ ...line, marginTop: 7 }}><span>金额</span><span className="num" style={{ color: 'var(--ink)' }}>¥1,000</span></div>
        <div style={{ ...line, marginTop: 7 }}><span>抵扣欠课时</span><span className="num" style={{ color: 'var(--ink)' }}>2 课次</span></div>
        {hr}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--ink-3)' }}>充值后可用</span><span className="num" style={{ fontWeight: 600 }}>8 课时</span></div>
        {o.receiptFooter && <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 12, lineHeight: 1.6 }}>{o.receiptFooter}</div>}
      </div>
    </Card>
  );
}

// =============== data ===============
const perBackupBytes = (info: api.DataInfo | null) => (info ? (info.backupCount > 0 ? info.backupTotalBytes / info.backupCount : info.dbSizeBytes) : 0);
const mb1 = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

export function DataSection({ d, patch, reload }: SP) {
  const b = d.backup;
  const set = (p: Partial<AllSettings['backup']>) => patch('backup', p);
  const toast = useToast();
  const confirm = useConfirm();
  const { tick, bump } = useRefresh();
  const info = useAsync(() => api.getDataInfo(), [tick]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [check, setCheck] = useState<InvariantReport | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(null); }
  };
  const backupNow = () => run('backup', async () => { const f = await api.backupNow(); toast(`已备份：${f.name}`, 'ok'); bump(); });
  const exportAll = () => run('export', async () => {
    const path = await saveDialog({ defaultPath: `coursehours-${todayStr()}.db`, filters: [{ name: 'SQLite 数据库', extensions: ['db'] }] });
    if (!path) return;
    await api.exportDatabase(path);
    toast('已导出全部数据', 'ok');
  });
  const restore = (f: BackupFile) => run('restore', async () => {
    setRestoreOpen(false);
    const ok = await confirm({ title: '从这份备份恢复？', danger: true, confirmText: '恢复',
      body: <>将用 <span className="num">{dt(f.createdAt)}</span> 的备份（{bytes(f.sizeBytes)}）覆盖当前全部数据。恢复前会先把当前数据备份一份。</> });
    if (!ok) return;
    await api.restoreBackup(f.path);
    toast('已从备份恢复', 'ok');
    bump(); reload?.();
  });
  const clearAll = () => run('clear', async () => {
    const ok = await confirm({ title: '清空全部数据？', danger: true, confirmText: '清空',
      body: '会删掉所有学生、班级、课次和流水。清空前会先自动备份一份到本机，但这个操作本身不可撤销。' });
    if (!ok) return;
    await api.clearAllData();
    toast('已清空全部数据', 'ok');
    bump(); reload?.();
  });
  const checkNow = () => run('check', async () => { setCheck(await api.checkInvariants()); });

  const btn: React.CSSProperties = { height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13 };
  return (
    <div>
      <h2 style={H2}>数据存在哪</h2>
      <p style={SUB}>所有数据只在这台 Mac 上，不上传任何服务器。</p>

      <Row style={{ marginTop: 6, gap: 14 }}>
        <span style={{ flexGrow: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5 }}>数据位置</span>
          <span className="num" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={info.data?.dbPath}>{info.data?.dbPath ?? '…'}</span>
        </span>
        <button type="button" className="btn" style={{ height: 34, borderRadius: 9, fontSize: 12.5 }} disabled={!info.data} onClick={() => info.data && revealItemInDir(info.data.dbPath).catch((e) => setErr(api.errMsg(e)))}>在访达中显示</button>
      </Row>

      <Row>
        <Switch on={b.auto} onChange={(v) => set({ auto: v })} label="每天自动备份" />
        <Text t="每天自动备份" s={b.auto ? `每晚 ${b.at} 自动备份到本机` : '已关闭，只能手动备份'} onClick={() => set({ auto: !b.auto })} />
        <TimeInput value={b.at} onChange={(v) => set({ at: v })} />
      </Row>
      <Row style={{ gap: 0 }}>
        <Text t="保留最近几份备份" s={<>超出的自动删掉，每份约 <span className="num">{info.data ? bytes(perBackupBytes(info.data)) : '—'}</span></>} />
        <Stepper value={b.keep} min={5} max={180} step={5} onChange={(v) => set({ keep: v })} />
        <Unit t="份" />
      </Row>

      <h2 style={{ ...H2, marginTop: 24 }}>导出与恢复</h2>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn" style={btn} disabled={busy !== null} onClick={backupNow}>立即备份</button>
        <button type="button" className="btn" style={btn} disabled={busy !== null} onClick={exportAll}>导出全部数据</button>
        <button type="button" className="btn" style={btn} disabled={busy !== null} onClick={() => setRestoreOpen(true)}>从备份恢复</button>
        <button type="button" className="btn sm ghost" style={{ color: 'var(--ink-3)' }} disabled={busy !== null} onClick={checkNow}>校验账本一致性</button>
      </div>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {check && (
        <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.7 }}>
          {check.ok
            ? <span style={{ color: 'var(--ok-ink)' }}>账本一致：已核对 <span className="num">{check.studentsChecked}</span> 名学生的余额与流水。</span>
            : <>
              <div style={{ color: 'var(--danger-ink)' }}>发现 <span className="num">{check.problems.length}</span> 处不一致（已核对 <span className="num">{check.studentsChecked}</span> 名学生）：</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--danger-ink)' }}>{check.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>}
        </div>
      )}

      <div style={{ marginTop: 22, padding: '14px 16px', border: '1px solid var(--banner-danger-line)', borderRadius: 12, background: 'var(--banner-danger-bg)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flexGrow: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink-on-danger)' }}>清空全部数据</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-on-danger)', marginTop: 3 }}>删掉所有学生、班级和流水。会先自动备份一份，但不可撤销。</span>
        </span>
        <button type="button" disabled={busy !== null} onClick={clearAll} style={{ height: 34, padding: '0 16px', border: '1px solid var(--danger)', borderRadius: 9, background: 'var(--surface)', color: 'var(--danger)', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>清空</button>
      </div>

      {restoreOpen && <RestoreModal onClose={() => setRestoreOpen(false)} onPick={restore} />}
    </div>
  );
}

function RestoreModal({ onClose, onPick }: { onClose: () => void; onPick: (f: BackupFile) => void }) {
  const { data, loading, error } = useAsync(() => api.listBackups(), []);
  return (
    <Modal title="从备份恢复" sub="选择一份备份，当前数据会被覆盖（恢复前会先自动备份）" onClose={onClose} width={480}
      footer={<button className="btn" onClick={onClose}>取消</button>}>
      {error && <div className="err">{error}</div>}
      {!data && loading && <Loading />}
      {data && data.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '8px 0' }}>还没有任何备份</div>}
      {data && data.length > 0 && (
        <div className="table" style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
          {data.map((f, i) => (
            <div key={f.path} className="trow clickable" style={{ minHeight: 46, borderTop: i === 0 ? 0 : undefined, padding: '0 14px' }} onClick={() => onPick(f)}>
              <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              <span className="num muted" style={{ fontSize: 12 }}>{bytes(f.sizeBytes)}</span>
              <span className="num" style={{ fontSize: 12.5, width: 84, textAlign: 'right' }}>{dt(f.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function DataPreview({ d }: { d: AllSettings }) {
  const { tick } = useRefresh();
  const info = useAsync(() => api.getDataInfo(), [tick]);
  const backups = useAsync(() => api.listBackups(), [tick]);
  const per = perBackupBytes(info.data);
  const keepHint = `当前保留最近 ${d.backup.keep} 份，约占 ${mb1(d.backup.keep * per)} MB。`;
  const recent = (backups.data ?? []).slice(0, 3);
  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' };
  return (
    <>
      <Card title="最近备份">
        {backups.data && recent.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>还没有备份</div>}
        {recent.map((f, i) => (
          <div key={f.path} style={{ ...line, marginTop: i === 0 ? 12 : 9 }}>
            <span className="num">{dt(f.createdAt)}</span><span style={{ color: 'var(--ink)' }}>{bytes(f.sizeBytes)}</span>
          </div>
        ))}
        <div style={NOTE}>{keepHint}</div>
      </Card>
      <Card title="数据量">
        {([['学生', info.data?.students], ['课次', info.data?.sessions], ['流水记录', info.data?.ledgerEntries]] as [string, number | undefined][]).map(([l, v], i) => (
          <div key={l} style={{ ...KV, marginTop: i === 0 ? 12 : 9 }}><span>{l}</span><span className="num" style={{ color: 'var(--ink)' }}>{v == null ? '—' : v.toLocaleString('en-US')}</span></div>
        ))}
      </Card>
    </>
  );
}

// =============== version ===============
function fmtBytes(n: number): string {
  return bytes(n);
}

/** 更新状态放在模块级，切换分区/页面时不丢 */
let lastInfo: api.UpdateInfo | null = null;

export function VersionSection() {
  const toast = useToast();
  const [version, setVersion] = useState('');
  const [info, setInfo] = useState<api.UpdateInfo | null>(lastInfo);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<api.UpdateProgress | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => { api.getAppVersion().then(setVersion).catch(() => {}); }, []);
  useEffect(() => {
    let un: (() => void) | undefined;
    let un2: (() => void) | undefined;
    listen<api.UpdateProgress>('update-progress', (e) => {
      setProgress(e.payload);
      if (e.payload.phase === 'error') setInstalling(false);
    }).then((f) => { un = f; });
    listen<api.UpdateInfo>('update-available', (e) => { lastInfo = e.payload; setInfo(e.payload); }).then((f) => { un2 = f; });
    return () => { un?.(); un2?.(); };
  }, []);

  const check = async (force = false) => {
    setChecking(true); setErr(null);
    try {
      const r = await api.checkUpdate(force);
      lastInfo = r; setInfo(r);
      if (!r.available) toast('已经是最新版本', 'ok');
    } catch (e) { setErr(api.errMsg(e)); } finally { setChecking(false); }
  };
  const install = async () => {
    if (!info?.asset) return;
    setInstalling(true); setErr(null); setProgress({ phase: 'downloading', received: 0, total: info.asset.size });
    try {
      await api.installUpdate(info.asset);
    } catch (e) { setErr(api.errMsg(e)); setInstalling(false); setProgress(null); }
  };

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const phaseText = progress?.phase === 'downloading' ? `下载中 ${pct}% · ${fmtBytes(progress.received)} / ${fmtBytes(progress.total)}`
    : progress?.phase === 'installing' ? '正在解压安装包…'
    : progress?.phase === 'restarting' ? '安装完成，正在重启…' : '';

  return (
    <div>
      <h2 style={H2}>版本</h2>
      <p style={SUB}>更新直接从 GitHub Releases 下载，安装后自动重启，数据不受影响。</p>

      <Row top h={64}>
        <Text t="当前版本" s={info ? `上次检查 ${dt(info.checkedAt)}` : '还没有检查过更新'} />
        <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>v{version || '—'}</span>
      </Row>

      <Row h={64}>
        <Text t="检查更新" s="启动 20 秒后和之后每 6 小时会自动静默检查一次" />
        <button type="button" className="btn" disabled={checking || installing} onClick={() => check(false)}>{checking ? '检查中…' : '立即检查'}</button>
      </Row>

      {info && (
        <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 12, background: info.available ? 'var(--accent-tint)' : 'var(--surface-soft)', border: `1px solid ${info.available ? 'var(--accent-soft)' : 'var(--line-faint)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{info.available ? `发现新版本 v${info.latest}` : `已是最新 · v${info.latest}`}</span>
            {info.publishedAt && <span className="muted" style={{ fontSize: 11.5 }}>发布于 {info.publishedAt.slice(0, 10)}</span>}
            <div style={{ flexGrow: 1 }} />
            <a role="button" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => openUrl(info.pageUrl)}>查看发布页</a>
          </div>
          {info.notes && (
            <pre style={{ margin: '10px 0 0', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 180, overflow: 'auto' }}>{info.notes.slice(0, 1200)}</pre>
          )}
          {info.available && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              {info.asset && info.canInstall ? (
                <button type="button" className="btn primary" disabled={installing} onClick={install}>
                  {installing ? '更新中…' : `下载并安装（${fmtBytes(info.asset.size)}）`}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => openUrl(info.pageUrl)}>去下载页</button>
              )}
              {!info.canInstall && <span className="muted" style={{ fontSize: 11.5 }}>开发模式不能原地更新</span>}
              {!info.asset && <span className="muted" style={{ fontSize: 11.5 }}>这个版本没有自动安装包</span>}
            </div>
          )}
          {progress && progress.phase !== 'error' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--line-mid)', overflow: 'hidden' }}>
                <div style={{ width: `${progress.phase === 'downloading' ? pct : 100}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{phaseText}</div>
            </div>
          )}
        </div>
      )}
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
        更新时会先把旧版本改名备份，新版本复制成功才删除备份，失败则自动回滚。应用需要放在「应用程序」或个人目录下才能原地更新。
        <br />
        <a role="button" style={{ cursor: 'pointer' }} onClick={() => check(true)}>用当前版本演练一次更新流程</a>
      </div>
    </div>
  );
}

export function VersionPreview() {
  return (
    <>
      <Card title="更新是怎么做的">
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7, marginTop: 8 }}>
          <div>1. 读取 GitHub 上 cod7ce/CourseHours 的 Releases</div>
          <div>2. 版本号比当前新就提示，点一下下载 zip</div>
          <div>3. 解压后退出应用，用脚本原地替换 .app，再自动打开</div>
          <div style={{ marginTop: 8, color: 'var(--ink-3)' }}>没有用系统级签名，所以第一次打开新版本时若系统拦截，在访达里右键 → 打开一次即可。</div>
        </div>
      </Card>
      <Card title="发新版本">
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7, marginTop: 8 }}>
          <div className="num">scripts/bump.sh 0.1.1</div>
          <div className="num">scripts/release.sh</div>
          <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>或者只推 tag，GitHub Actions 会自动构建并上传到 Release。</div>
        </div>
      </Card>
    </>
  );
}
