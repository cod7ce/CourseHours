import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import type { Klass, RuleSummary } from '../lib/api';
import { CLASS_COLORS } from '../lib/format';
import { ApplyFutureRow, ScheduleEditor, slotsFromRules, slotsToRules, validateSlots, type Slot } from './ScheduleEditor';
import { Kbd, Modal, Stepper, useFormShortcuts, useRefresh, useToast } from './ui';

/** 新建 / 编辑班级。上课时间按「每天一个时段」填写。 */
export function ClassFormModal({ klass, rules, onClose, onDone, onCreated }: {
  klass?: Klass | null; rules?: RuleSummary[]; onClose: () => void; onDone: (id: string) => void;
  /** 「保存并继续」时回调，弹窗保持打开 */
  onCreated?: (id: string) => void;
}) {
  const [savedCount, setSavedCount] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { bump } = useRefresh();
  const editing = !!klass;

  const [name, setName] = useState(klass?.name ?? '');
  const [color, setColor] = useState(klass?.color ?? CLASS_COLORS[0]);
  const [room, setRoom] = useState(klass?.room ?? '');
  const [capacity, setCapacity] = useState<number>(klass?.capacity ?? 10);
  const [duration, setDuration] = useState<number>(klass?.durationMin ?? 90);
  const [rooms, setRooms] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>(() => slotsFromRules(rules ?? []));
  const [applyFuture, setApplyFuture] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setRooms(s.defaults.rooms);
      if (!editing) {
        setCapacity(s.defaults.classCapacity || 10);
        setDuration(s.defaults.durationMin || 90);
        setRoom((r) => r || s.defaults.defaultRoom || '');
      }
    }).catch(() => {});
  }, [editing]);

  const initialSlotsKey = JSON.stringify(slotsToRules(slotsFromRules(rules ?? [])));
  const scheduleChanged = JSON.stringify(slotsToRules(slots)) !== initialSlotsKey;

  const submit = async (andContinue = false) => {
    if (!name.trim()) { setErr('请填写班级名称'); return; }
    if (!(capacity > 0)) { setErr('人数上限需大于 0'); return; }
    if (!(duration > 0)) { setErr('单次时长需大于 0'); return; }
    const v = validateSlots(slots);
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    try {
      const input = { name: name.trim(), color, room: room.trim() || null, capacity, durationMin: duration };
      if (editing && klass) {
        await api.updateClass(klass.id, input);
        if (scheduleChanged) await api.setClassSchedule(klass.id, slotsToRules(slots), applyFuture);
        toast('班级已更新', 'ok');
        bump();
        onDone(klass.id);
      } else {
        const created = await api.createClass({ ...input, rules: slotsToRules(slots) });
        bump();
        if (andContinue) {
          setSavedCount((n) => n + 1);
          toast(`已创建 ${created.name}，继续建下一个`, 'ok');
          onCreated?.(created.id);
          // 名称、时段清空；颜色换下一个，教室 / 上限 / 时长保留
          setName(''); setSlots([]);
          setColor((c) => CLASS_COLORS[(CLASS_COLORS.indexOf(c) + 1) % CLASS_COLORS.length]);
          nameRef.current?.focus();
        } else {
          toast('班级已创建', 'ok');
          onDone(created.id);
        }
      }
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  useFormShortcuts({ onSubmit: () => submit(false), onContinue: editing ? undefined : () => submit(true), enabled: !busy });

  return (
    <Modal title={editing ? '编辑班级' : '新建班级'}
      sub={editing ? '修改不影响已产生的流水' : savedCount > 0 ? `本次已创建 ${savedCount} 个班级` : '设定上课时段、人数上限和单次时长'}
      onClose={onClose} width={640}
      footer={<>
        <button className="btn" onClick={onClose}>取消<Kbd>Esc</Kbd></button>
        {!editing && <button className="btn" disabled={busy} onClick={() => submit(true)}>保存并继续<Kbd>⌘ + ⏎</Kbd></button>}
        <button className="btn primary" disabled={busy} onClick={() => submit(false)}>{editing ? '保存' : '创建班级'}<Kbd>⏎</Kbd></button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'end' }}>
        <div className="field">
          <label>班级名称</label>
          <input ref={nameRef} className="input" value={name} autoFocus placeholder="例如：Movers B 班" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>颜色</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', height: 36 }}>
            {CLASS_COLORS.map((c) => {
              const on = c.toUpperCase() === color.toUpperCase();
              return (
                <button key={c} type="button" aria-label={c} aria-pressed={on} onClick={() => setColor(c)}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: 0, cursor: 'pointer', padding: 0, boxShadow: on ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${c}` : 'none' }} />
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>默认教室</label>
          <input className="input" list="class-form-rooms" value={room} placeholder="可留空" onChange={(e) => setRoom(e.target.value)} />
          <datalist id="class-form-rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        <div className="field">
          <label>人数上限</label>
          <Stepper value={capacity} onChange={setCapacity} min={1} max={99} />
        </div>
        <div className="field">
          <label>单次时长</label>
          <Stepper value={duration} onChange={setDuration} min={15} max={600} step={15} format={(v) => `${v} 分`} />
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>上课时间 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{editing ? '' : '可选，之后也能在「排课」里改'}</span></div>
          {slots.length === 0 && <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>例如：周五 17:00 – 18:30，周六 10:00 – 11:30</div>}
        </div>
        <ScheduleEditor slots={slots} onChange={setSlots} durationMin={duration} defaultRoom={room} rooms={rooms} />
        {editing && scheduleChanged && <ApplyFutureRow on={applyFuture} onChange={setApplyFuture} />}
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
