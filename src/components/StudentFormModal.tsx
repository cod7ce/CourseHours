import { useState } from 'react';
import * as api from '../lib/api';
import type { ClassCard, Student, StudentInput } from '../lib/api';
import { DatePicker } from './pickers';
import { Modal, Dot } from './ui';
import { IconCheck } from './icons';
import { todayStr } from '../lib/format';

/** 新增 / 编辑学生。新建时可多选加入班级；编辑时可改状态。 */
export function StudentFormModal({ student, classes, onClose, onDone }: {
  student?: Student | null;
  classes: ClassCard[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const editing = !!student;
  const [name, setName] = useState(student?.name ?? '');
  const [enName, setEnName] = useState(student?.enName ?? '');
  const [enrolledOn, setEnrolledOn] = useState(student?.enrolledOn ?? todayStr());
  const [guardianName, setGuardianName] = useState(student?.guardianName ?? '');
  const [phone, setPhone] = useState(student?.phone ?? '');
  const [note, setNote] = useState(student?.note ?? '');
  const [status, setStatus] = useState<'active' | 'paused' | 'left'>(student?.status ?? 'active');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleClass = (id: string) =>
    setClassIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (!name.trim()) { setErr('姓名不能为空'); return; }
    setBusy(true); setErr(null);
    const input: StudentInput = {
      name: name.trim(),
      enName: enName.trim() || null,
      enrolledOn: enrolledOn || null,
      guardianName: guardianName.trim() || null,
      phone: phone.trim() || null,
      note: note.trim() || null,
    };
    try {
      if (editing && student) {
        const s = await api.updateStudent(student.id, { ...input, status });
        onDone(s.id);
      } else {
        const s = await api.createStudent({ ...input, classIds });
        onDone(s.id);
      }
    } catch (e) {
      setErr(api.errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const activeClasses = classes.filter((c) => c.status === 'active');

  return (
    <Modal
      title={editing ? '编辑资料' : '新增学生'}
      sub={editing ? student?.name : '入学日期默认今天，可稍后再补充家长与电话'}
      onClose={onClose}
      width={520}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>取消</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{editing ? '保存' : '新增'}</button>
      </>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="field">
          <label>姓名 <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="学生姓名" />
        </div>
        <div className="field">
          <label>英文名</label>
          <input className="input" value={enName} onChange={(e) => setEnName(e.target.value)} placeholder="选填" />
        </div>
        <div className="field">
          <label>入学日期</label>
          <DatePicker value={enrolledOn} onChange={setEnrolledOn} />
        </div>
        {editing ? (
          <div className="field">
            <label>状态</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'paused' | 'left')}>
              <option value="active">在读</option>
              <option value="paused">已停课</option>
              <option value="left">已退班</option>
            </select>
          </div>
        ) : <div />}
        <div className="field">
          <label>家长</label>
          <input className="input" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="家长姓名" />
        </div>
        <div className="field">
          <label>电话</label>
          <input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="联系电话" />
        </div>
      </div>
      <div className="field">
        <label>备注</label>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
      </div>
      {!editing && (
        <div className="field">
          <label>加入班级 <span className="faint">（可多选，也可稍后在班级页添加）</span></label>
          {activeClasses.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>还没有班级</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {activeClasses.map((c) => {
                const on = classIds.includes(c.id);
                return (
                  <button
                    key={c.id} type="button" className={`chip ${on ? 'on' : ''}`}
                    onClick={() => toggleClass(c.id)} aria-pressed={on}
                  >
                    {on ? <IconCheck size={12} /> : <Dot color={c.color} />}
                    {c.name}
                    <span className="cnt">{c.enrolled} / {c.capacity}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {editing && status === 'left' && (
        <div className="muted" style={{ fontSize: 12 }}>标记为已退班后，会自动结束该学生所有在班关系。</div>
      )}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
