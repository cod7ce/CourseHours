import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import type { ClassCard } from '../lib/api';
import { todayStr } from '../lib/format';
import { Dot, Modal, useRefresh, useToast } from './ui';

import { DatePicker } from './pickers';
import { addMinutes, TimeRangeFields } from './TimeRange';

/** 临时加课弹窗：课表与排课页共用 */
export function ExtraSessionModal({ classes, defaultDate, onClose, onDone }: {
  classes: ClassCard[]; defaultDate?: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const { bump } = useRefresh();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate ?? todayStr());
  const [start, setStart] = useState('18:30');
  const [end, setEnd] = useState('20:00');
  const [room, setRoom] = useState('');
  const [note, setNote] = useState('');
  const [rooms, setRooms] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const klass = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId]);

  useEffect(() => {
    api.getSettings().then((s) => setRooms(s.defaults.rooms)).catch(() => {});
  }, []);

  // 切换班级：教室与时长跟随班级默认值
  useEffect(() => {
    if (!klass) return;
    setRoom(klass.room ?? '');
    setEnd(addMinutes(start, klass.durationMin || 90));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klass?.id]);

  const [savedCount, setSavedCount] = useState(0);
  const submit = async (andContinue = false) => {
    if (!classId) { setErr('请选择班级'); return; }
    if (!date) { setErr('请选择日期'); return; }
    if (end <= start) { setErr('结束时间需晚于开始时间'); return; }
    setBusy(true); setErr(null);
    try {
      await api.addExtraSession({ classId, date, startTime: start, endTime: end, room: room.trim() || null, note: note.trim() || null });
      bump();
      if (andContinue) {
        setSavedCount((n) => n + 1);
        toast('已添加，继续加下一节', 'ok');
        setNote('');
      } else {
        toast('已添加临时课次', 'ok');
        onDone();
      }
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="临时加课" sub="加课只创建一节课次，课时在点名时才扣" onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={savedCount > 0 ? onDone : onClose}>{savedCount > 0 ? '完成' : '取消'}</button>
        <button className="btn" disabled={busy || classes.length === 0} onClick={() => submit(true)}>添加并继续</button>
        <button className="btn primary" disabled={busy || classes.length === 0} onClick={() => submit(false)}>添加课次</button>
      </>}>
      {classes.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>还没有在读班级，先去「班级」新建一个。</div>
      ) : (
        <>
          <div className="field">
            <label>班级</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {klass && <Dot color={klass.color} size={9} />}
              <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.enrolled} 人</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>日期</label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <TimeRangeFields start={start} end={end} durationMin={klass?.durationMin || 90}
            onStart={(v) => { setStart(v); setEnd(addMinutes(v, klass?.durationMin || 90)); }}
            onEnd={(v) => { setEnd(v); setStart(addMinutes(v, -(klass?.durationMin || 90))); }} />
          <div className="field">
            <label>教室</label>
            <input className="input" list="extra-session-rooms" value={room} placeholder="可留空" onChange={(e) => setRoom(e.target.value)} />
            <datalist id="extra-session-rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="field">
            <label>备注</label>
            <input className="input" value={note} placeholder="例如：考前加练 / 由 9-15 调课而来" onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="err">{err}</div>}
        </>
      )}
    </Modal>
  );
}
