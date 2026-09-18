import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { RuleInput, RuleSummary } from '../lib/api';
import { IconClose, IconPlus } from './icons';
import { TimePicker } from './pickers';
import { addMinutes } from './TimeRange';
import { Modal, useRefresh, useToast } from './ui';

export interface Slot { id: string; weekday: number; start: string; end: string; room: string }

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
let seq = 0;
const nid = () => `slot-${++seq}-${Date.now()}`;

/** 把规则（一条可能含多天）展开成逐天时段 */
export function slotsFromRules(rules: RuleSummary[]): Slot[] {
  const out: Slot[] = [];
  rules.filter((r) => r.active).forEach((r) => {
    r.weekdays.forEach((d) => out.push({ id: nid(), weekday: d, start: r.startTime, end: r.endTime, room: r.room ?? '' }));
  });
  return out.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
}

export function slotsToRules(slots: Slot[]): RuleInput[] {
  return slots.map((s) => ({ weekdays: [s.weekday], startTime: s.start, endTime: s.end, room: s.room.trim() || null }));
}

export function validateSlots(slots: Slot[]): string | null {
  for (const s of slots) {
    if (!s.start || !s.end) return '请填写完整的开始与结束时间';
    if (s.end <= s.start) return `${WEEKDAYS[s.weekday - 1]}：结束时间需晚于开始时间`;
  }
  const seen = new Set<string>();
  for (const s of slots) {
    const k = `${s.weekday}|${s.start}`;
    if (seen.has(k)) return `${WEEKDAYS[s.weekday - 1]} ${s.start} 重复了`;
    seen.add(k);
  }
  return null;
}

/** 逐天时段编辑器：每行 周几 · 开始 – 结束 · 教室，改开始/结束按时长联动 */
export function ScheduleEditor({ slots, onChange, durationMin, defaultRoom, rooms }: {
  slots: Slot[]; onChange: (s: Slot[]) => void; durationMin: number; defaultRoom: string; rooms: string[];
}) {
  const update = (id: string, patch: Partial<Slot>) => onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => onChange(slots.filter((s) => s.id !== id));
  const add = () => {
    const used = new Set(slots.map((s) => s.weekday));
    const weekday = [1, 2, 3, 4, 5, 6, 7].find((d) => !used.has(d)) ?? 1;
    const last = slots[slots.length - 1];
    const start = last?.start ?? '18:30';
    onChange([...slots, { id: nid(), weekday, start, end: addMinutes(start, durationMin), room: last?.room ?? defaultRoom }]);
  };
  const listId = useMemo(() => `rooms-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {slots.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 1fr 1fr 28px', gap: 8, fontSize: 11.5, color: 'var(--ink-3)', padding: '0 2px' }}>
          <span>周几</span><span>开始</span><span>结束</span><span>教室</span><span />
        </div>
      )}
      {slots.map((s) => (
        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 1fr 1fr 28px', gap: 8, alignItems: 'center' }}>
          <select className="input" value={s.weekday} onChange={(e) => update(s.id, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
          </select>
          <TimePicker value={s.start} onChange={(v) => update(s.id, { start: v, end: addMinutes(v, durationMin) })} />
          <TimePicker value={s.end} onChange={(v) => update(s.id, { end: v, start: addMinutes(v, -durationMin) })} />
          <input className="input" list={listId} value={s.room} placeholder="教室" onChange={(e) => update(s.id, { room: e.target.value })} />
          <button type="button" aria-label="删除" onClick={() => remove(s.id)}
            style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconClose size={13} />
          </button>
        </div>
      ))}
      <datalist id={listId}>{rooms.map((r) => <option key={r} value={r} />)}</datalist>
      <button type="button" onClick={add} style={{
        alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
        border: '1px dashed var(--dashed)', borderRadius: 8, background: 'transparent', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer',
      }}><IconPlus size={13} /> 添加一天</button>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
        改开始或结束，另一头按单次时长 <span className="num">{durationMin}</span> 分钟自动算；每天可以是不同时段。
      </div>
    </div>
  );
}

/** 单独编辑某个班的上课时间（排课页用） */
export function ClassScheduleModal({ classId, className, durationMin, defaultRoom, rules, onClose, onDone }: {
  classId: string; className: string; durationMin: number; defaultRoom: string; rules: RuleSummary[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { bump } = useRefresh();
  const [slots, setSlots] = useState<Slot[]>(() => slotsFromRules(rules));
  const [applyFuture, setApplyFuture] = useState(true);
  const [rooms, setRooms] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getSettings().then((s) => setRooms(s.defaults.rooms)).catch(() => {}); }, []);

  const submit = async () => {
    const v = validateSlots(slots);
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.setClassSchedule(classId, slotsToRules(slots), applyFuture);
      const parts = [];
      if (r.removedSessions > 0) parts.push(`移除 ${r.removedSessions} 节未开始的课`);
      if (r.createdSessions > 0) parts.push(`补生成 ${r.createdSessions} 节`);
      toast(parts.length ? `上课时间已更新 · ${parts.join('，')}` : '上课时间已更新', 'ok');
      bump();
      onDone();
    } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${className} · 上课时间`} sub="每天一行，可以是不同时段" onClose={onClose} width={620}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={submit}>保存</button>
      </>}>
      <ScheduleEditor slots={slots} onChange={setSlots} durationMin={durationMin} defaultRoom={defaultRoom} rooms={rooms} />
      <ApplyFutureRow on={applyFuture} onChange={setApplyFuture} />
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}

export function ApplyFutureRow({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'var(--surface-soft)', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        <span style={{ display: 'block', fontSize: 13 }}>同时更新今天之后未点名的课次</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
          按新时间重新排到原来的终点；已点名的课、临时加课、手动改过时间的课不动。不勾选则只影响以后生成的课次。
        </span>
      </span>
    </label>
  );
}
