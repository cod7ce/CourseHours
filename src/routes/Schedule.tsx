import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import * as api from '../lib/api';
import type { SessionView } from '../lib/api';
import { addDays, classTone, cnDate, cnFullDate, num, todayStr } from '../lib/format';
import { ExtraSessionModal } from '../components/ExtraSessionModal';
import { IconBack, IconNext } from '../components/icons';
import { DatePicker, fromMinutes, toMinutes } from '../components/pickers';
import { TimeRangeFields, addMinutes } from '../components/TimeRange';
import { Loading, Modal, PageHeader, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';

const HOUR_H = 52;
const START_H = 9;
const END_H = 21;
const GRID_H = (END_H - START_H) * HOUR_H; // 624
const AXIS_W = 54;
const SNAP_MIN = 15;
const SNAP_PX = (HOUR_H * SNAP_MIN) / 60; // 13px
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOURS = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

/** 课块的垂直位置：top = (startHour-9)*52 + minutes/60*52 */
function blockRect(s: SessionView): { top: number; height: number } {
  const start = toMinutes(s.startTime) - START_H * 60;
  const end = toMinutes(s.endTime) - START_H * 60;
  const top = Math.max(0, (start / 60) * HOUR_H);
  const bottom = Math.min(GRID_H, (end / 60) * HOUR_H);
  return { top, height: Math.max(28, bottom - top) };
}

function subText(s: SessionView, isToday: boolean): { text: string; color: string; strike?: boolean } {
  if (s.status === 'cancelled') return { text: `已取消${s.cancelReason ? ' · ' + s.cancelReason : ''}`, color: 'var(--ink-4)', strike: true };
  if (s.status === 'taken') return { text: `已点名 · 扣 ${num(s.hours)} 课时`, color: 'var(--ok-ink)' };
  if (s.kind === 'extra' && s.note) return { text: s.note, color: 'var(--neutral-ink)' };
  if (isToday) return { text: `待点名 · 预计扣 ${num(s.hours)} 课时`, color: 'var(--accent-deep)' };
  return { text: `${s.enrolled} 人 · 预计扣 ${num(s.hours)} 课时`, color: 'var(--neutral-ink)' };
}

interface Drag {
  s: SessionView; startX: number; startY: number; origTop: number; origDay: number; height: number;
  top: number; day: number; moved: boolean;
}

export function Schedule() {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();
  const [anchor, setAnchor] = useState(todayStr());
  const { data, loading, error, reload } = useAsync(() => api.listSessions(anchor), [anchor]);

  const [cancelledView, setCancelledView] = useState<SessionView | null>(null);
  const [acting, setActing] = useState<SessionView | null>(null);
  const [extraOpen, setExtraOpen] = useState<string | null>(null); // 默认日期
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  const days = useMemo(() => (data ? Array.from({ length: 7 }, (_, i) => addDays(data.from, i)) : []), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, SessionView[]>();
    data?.sessions.forEach((s) => { m.set(s.date, [...(m.get(s.date) ?? []), s]); });
    return m;
  }, [data]);

  const openBlock = (s: SessionView) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (s.status === 'cancelled') setCancelledView(s);
    else nav(`/sessions/${s.id}/roll-call`, { state: { from: '/schedule', label: '课表' } });
  };
  const openActions = (e: ReactMouseEvent, s: SessionView) => {
    e.preventDefault(); e.stopPropagation();
    if (s.status === 'planned') setActing(s);
  };

  const afterWrite = useCallback(() => { reload(); bump(); }, [reload, bump]);

  // ---------- 拖拽（15 分钟吸附，可跨天） ----------
  const colWidth = () => {
    const w = gridRef.current?.clientWidth ?? 0;
    return Math.max(1, (w - AXIS_W) / 7);
  };
  const beginDrag = (e: ReactMouseEvent, s: SessionView, dayIdx: number) => {
    if (e.button !== 0 || s.status !== 'planned') return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const { top, height } = blockRect(s);
    const d: Drag = { s, startX: e.clientX, startY: e.clientY, origTop: top, origDay: dayIdx, height, top, day: dayIdx, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      const dx = e.clientX - d.startX;
      const top = Math.max(0, Math.min(GRID_H - d.height, Math.round((d.origTop + dy) / SNAP_PX) * SNAP_PX));
      const day = Math.max(0, Math.min(6, d.origDay + Math.round(dx / colWidth())));
      const moved = d.moved || Math.abs(dy) > 4 || day !== d.origDay;
      const next = { ...d, top, day, moved };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = async () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (!d.moved) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const startMin = START_H * 60 + Math.round((d.top / HOUR_H) * 60);
      const durationMin = toMinutes(d.s.endTime) - toMinutes(d.s.startTime);
      const newStart = fromMinutes(startMin);
      const newEnd = fromMinutes(startMin + durationMin);
      const newDate = days[d.day] ?? d.s.date;
      if (newStart === d.s.startTime && newDate === d.s.date) return;
      try {
        await api.updateSession(d.s.id, { date: newDate, startTime: newStart, endTime: newEnd, room: d.s.room, note: d.s.note });
        toast(`已移到 ${cnDate(newDate)} ${newStart}`, 'ok');
        afterWrite();
      } catch (err) {
        toast(api.errMsg(err), 'danger');
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const sub = data ? `${cnFullDate(data.from)} – ${cnDate(data.to)}` : ' ';
  const ghostTime = drag && drag.moved
    ? (() => {
        const startMin = START_H * 60 + Math.round((drag.top / HOUR_H) * 60);
        const dur = toMinutes(drag.s.endTime) - toMinutes(drag.s.startTime);
        return `${fromMinutes(startMin)} – ${fromMinutes(startMin + dur)}`;
      })()
    : null;

  return (
    <>
      <PageHeader title="课表" sub={sub} right={<>
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-ctrl)', borderRadius: 9, overflow: 'hidden' }}>
          <button type="button" aria-label="上一周" onClick={() => setAnchor(addDays(anchor, -7))}
            style={{ width: 36, height: 36, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconBack size={15} />
          </button>
          <span style={{ width: 1, height: 20, background: 'var(--line-mid)' }} />
          <button type="button" onClick={() => setAnchor(todayStr())}
            style={{ height: 36, padding: '0 14px', border: 0, background: 'transparent', fontSize: 13, cursor: 'pointer' }}>本周</button>
          <span style={{ width: 1, height: 20, background: 'var(--line-mid)' }} />
          <button type="button" aria-label="下一周" onClick={() => setAnchor(addDays(anchor, 7))}
            style={{ width: 36, height: 36, border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconNext size={15} />
          </button>
        </div>
        <button className="btn" onClick={() => setExtraOpen(anchor)}>临时加课</button>
        <Link className="btn primary" to="/schedule/planning">排课</Link>
      </>} />

      <div className="page-body fixed" style={{ padding: '16px 32px 20px', gap: 12 }}>
        {error && <div className="err">{error}</div>}
        {!data && loading && <Loading />}
        {data && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 0 }}>
              {data.classes.map((k) => (
                <span key={k.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: k.color }} />{k.name} · <span className="num">{k.enrolled}</span> 人
                </span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--class-6)' }} />一对一 / 补课
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-4)' }}>拖动待点名的课块可改时间，按 15 分钟对齐</span>
            </div>

            {data.sessions.length === 0 && (
              <div className="card card-sunk" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', fontSize: 12.5, color: 'var(--ink-3)' }}>
                <span>这周没有排课</span>
                <Link to="/schedule/planning" style={{ fontSize: 12.5 }}>去排课</Link>
              </div>
            )}

            <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
              <div ref={gridRef} className="card" style={{ display: 'flex', overflow: 'hidden', minWidth: 720, position: 'relative', cursor: drag?.moved ? 'grabbing' : undefined }}>
                {/* 时间轴 */}
                <div style={{ width: AXIS_W, flexShrink: 0 }}>
                  <div style={{ height: 52, borderBottom: '1px solid var(--line)' }} />
                  <div style={{ position: 'relative', height: GRID_H }}>
                    {HOURS.map((h, i) => (
                      <span key={h} className="num" style={{
                        position: 'absolute', right: 10, fontSize: 11.5, color: 'var(--ink-4)',
                        top: i === 0 ? -7 : i === HOURS.length - 1 ? GRID_H - 11 : i * HOUR_H - 7,
                      }}>{String(h).padStart(2, '0')}:00</span>
                    ))}
                  </div>
                </div>

                {days.map((d, i) => {
                  const isToday = d === data.today;
                  const nextIsToday = days[i + 1] === data.today;
                  const list = byDay.get(d) ?? [];
                  const bodyBg = isToday
                    ? 'repeating-linear-gradient(to bottom, var(--col-today-ln) 0, var(--col-today-ln) 1px, var(--row-today) 1px, var(--row-today) 52px)'
                    : 'repeating-linear-gradient(to bottom, var(--line-soft) 0, var(--line-soft) 1px, var(--surface) 1px, var(--surface) 52px)';
                  const dropTarget = drag?.moved && drag.day === i;
                  return (
                    <div key={d} style={{ flexGrow: 1, minWidth: 0, flexBasis: 0, borderLeft: `1px solid ${isToday || nextIsToday ? 'var(--line-ctrl)' : 'var(--line-faint)'}` }}>
                      <div style={{
                        height: 52, borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: isToday ? 2 : 1, background: isToday ? 'var(--col-today-hd)' : dropTarget ? 'var(--accent-tint)' : undefined,
                      }}>
                        <span style={{ fontSize: 11.5, color: isToday ? 'var(--accent-deep)' : 'var(--ink-3)' }}>{WEEKDAYS[i]}</span>
                        {isToday ? (
                          <span className="num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--nav-text-on)', fontSize: 14, fontWeight: 600 }}>{Number(d.slice(8))}</span>
                        ) : (
                          <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>{Number(d.slice(8))}</span>
                        )}
                      </div>
                      <div style={{ position: 'relative', height: GRID_H, background: bodyBg }}>
                        {list.map((s) => (
                          <Block key={s.id} s={s} isToday={isToday} dimmed={!!drag?.moved && drag.s.id === s.id}
                            onOpen={() => openBlock(s)} onActions={(e) => openActions(e, s)} onDragStart={(e) => beginDrag(e, s, i)} />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* 拖拽幽灵块 */}
                {drag?.moved && ghostTime && (
                  <div style={{
                    position: 'absolute', pointerEvents: 'none', zIndex: 5,
                    left: `calc(${AXIS_W}px + ${drag.day} * ((100% - ${AXIS_W}px) / 7) + 6px)`,
                    width: `calc((100% - ${AXIS_W}px) / 7 - 12px)`,
                    top: 52 + drag.top, height: drag.height, boxSizing: 'border-box', padding: '8px 10px',
                    borderRadius: 9, background: classTone(drag.s.classColor).soft, border: `1.5px solid ${drag.s.classColor}`,
                    boxShadow: '0 10px 24px -10px rgba(60, 30, 10, .45)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: drag.s.classColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{drag.s.className}</span>
                    </div>
                    <div className="num" style={{ fontSize: 11.5, color: 'var(--accent-deep)', marginTop: 4, fontWeight: 600 }}>{ghostTime}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{cnDate(days[drag.day])} · {WEEKDAYS[drag.day]}</div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {cancelledView && (
        <Modal title="这节课已取消" sub={`${cancelledView.className} · ${cnDate(cancelledView.date)} ${cancelledView.startTime} – ${cancelledView.endTime}`} onClose={() => setCancelledView(null)} width={420}
          footer={<>
            <button className="btn sm" style={{ color: 'var(--danger-ink)', marginRight: 'auto' }} onClick={async () => {
              const s = cancelledView;
              const ok = await confirm({ title: '从课表上删除这节课？', body: <>{s.className} · {cnDate(s.date)} {s.startTime} – {s.endTime}<br />删掉后课表上不再显示这个灰块。</>, danger: true, confirmText: '删除' });
              if (!ok) return;
              try { await api.deleteSession(s.id); toast('已删除课次', 'ok'); setCancelledView(null); afterWrite(); } catch (e) { toast(api.errMsg(e), 'danger'); }
            }}>删除这节课</button>
            <button className="btn" onClick={() => setCancelledView(null)}>关闭</button>
          </>}>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>取消原因</div>
            <div style={{ marginTop: 4 }}>{cancelledView.cancelReason || '未填写原因'}</div>
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>取消不顺延，不扣任何人的课时。</div>
          </div>
        </Modal>
      )}

      {acting && data && (
        <SessionActionModal s={acting} durationMin={data.classes.find((c) => c.id === acting.classId)?.durationMin ?? (toMinutes(acting.endTime) - toMinutes(acting.startTime))}
          onClose={() => setActing(null)}
          onSaved={() => { setActing(null); afterWrite(); }}
          confirm={confirm} toast={toast} />
      )}

      {extraOpen !== null && data && (
        <ExtraSessionModal classes={data.classes} defaultDate={extraOpen}
          onClose={() => setExtraOpen(null)} onDone={() => { setExtraOpen(null); afterWrite(); }} />
      )}
    </>
  );
}

function Block({ s, isToday, dimmed, onOpen, onActions, onDragStart }: {
  s: SessionView; isToday: boolean; dimmed: boolean; onOpen: () => void; onActions: (e: ReactMouseEvent) => void; onDragStart: (e: ReactMouseEvent) => void;
}) {
  const { top, height } = blockRect(s);
  const tone = classTone(s.classColor);
  const cancelled = s.status === 'cancelled';
  const pendingToday = isToday && s.status === 'planned';
  const sub = subText(s, isToday);
  const bg = cancelled ? 'var(--neutral-soft)' : tone.soft;
  const border = cancelled
    ? '1px solid var(--dashed)'
    : s.kind === 'extra'
      ? '1px dashed var(--dashed-soft)'
      : pendingToday ? `1.5px solid ${s.classColor}` : `1px solid ${tone.line}`;
  const compact = height < 60;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onContextMenu={onActions} onMouseDown={onDragStart}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      title={`${s.className} ${s.startTime} – ${s.endTime}${s.room ? ' · ' + s.room : ''}${s.status === 'planned' ? '\n拖动可改时间' : ''}`}
      style={{
        position: 'absolute', left: 6, right: 6, top, height, boxSizing: 'border-box', padding: compact ? '5px 10px' : '8px 10px',
        borderRadius: 9, background: bg, border, cursor: s.status === 'planned' ? 'grab' : 'pointer', overflow: 'hidden', color: 'var(--ink)',
        opacity: dimmed ? 0.35 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cancelled ? 'var(--ink-4)' : s.classColor, flexShrink: 0 }} />
        <span className={cancelled ? 'strike' : ''} style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexGrow: 1, minWidth: 0 }}>{s.className}</span>
        {s.holiday && !cancelled && (
          <span style={{ fontSize: 10.5, color: 'var(--warn-ink)', flexShrink: 0 }}>{s.holiday}</span>
        )}
        {s.status === 'planned' && (
          <button type="button" aria-label="更多操作" onClick={onActions}
            style={{ width: 18, height: 16, border: 0, borderRadius: 4, background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, flexShrink: 0, letterSpacing: 1 }}>···</button>
        )}
      </div>
      {!compact && (
        <>
          <div className={`num ${cancelled ? 'strike' : ''}`} style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 4 }}>{s.startTime} – {s.endTime}</div>
          <div className={sub.strike ? 'strike' : ''} style={{ fontSize: 11, color: sub.color, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.text}</div>
        </>
      )}
    </div>
  );
}

function SessionActionModal({ s, durationMin, onClose, onSaved, confirm, toast }: {
  s: SessionView; durationMin: number; onClose: () => void; onSaved: () => void;
  confirm: ReturnType<typeof useConfirm>; toast: ReturnType<typeof useToast>;
}) {
  const [date, setDate] = useState(s.date);
  const [start, setStart] = useState(s.startTime);
  const [end, setEnd] = useState(s.endTime);
  const [room, setRoom] = useState(s.room ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = date !== s.date || start !== s.startTime || end !== s.endTime || (room.trim() || null) !== (s.room ?? null);

  const save = async () => {
    if (end <= start) { setErr('结束时间需晚于开始时间'); return; }
    setBusy(true); setErr(null);
    try {
      await api.updateSession(s.id, { date, startTime: start, endTime: end, room: room.trim() || null, note: s.note });
      toast('已改时间', 'ok');
      onSaved();
    } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirm({
      title: '删除这节课？',
      body: <>{s.className} · {cnDate(s.date)} {s.startTime} – {s.endTime}<br />直接从课表上删掉，不留取消记录。适合误加或多排的课；正常停课请用「取消课次」。</>,
      danger: true, confirmText: '删除',
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await api.deleteSession(s.id);
      toast('已删除课次', 'ok');
      onSaved();
    } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(false); }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: '取消这节课？',
      body: <>{s.className} · {cnDate(s.date)} {s.startTime} – {s.endTime}<br />取消不顺延，不扣任何人的课时。</>,
      danger: true, confirmText: '取消这节课',
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await api.cancelSession(s.id, reason.trim() || undefined);
      toast('已取消课次', 'ok');
      onSaved();
    } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={s.className} sub={<span className="num">{cnDate(s.date)} {s.startTime} – {s.endTime}{s.room ? ` · ${s.room}` : ''}</span>} onClose={onClose} width={480}
      footer={<>
        <button className="btn" onClick={onClose}>关闭</button>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>保存时间</button>
      </>}>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>改时间只影响这一节课，不改循环规则。也可以直接在课表上拖动课块。</div>
      <div className="field">
        <label>日期</label>
        <DatePicker value={date} onChange={setDate} />
      </div>
      <TimeRangeFields start={start} end={end} durationMin={durationMin}
        onStart={(v) => { setStart(v); setEnd(addMinutes(v, durationMin)); }}
        onEnd={(v) => { setEnd(v); setStart(addMinutes(v, -durationMin)); }} />
      <div className="field">
        <label>教室</label>
        <input className="input" value={room} placeholder="可留空" onChange={(e) => setRoom(e.target.value)} />
      </div>

      <div style={{ borderTop: '1px solid var(--line-faint)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>取消这节课</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" value={reason} placeholder="原因，例如：老师出差 / 台风停课" onChange={(e) => setReason(e.target.value)} />
          <button className="btn danger" style={{ flexShrink: 0 }} disabled={busy} onClick={cancel}>取消课次</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>取消会在课表上留一个灰色划线块，不顺延。</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <span className="muted" style={{ fontSize: 11.5, flexGrow: 1 }}>误加或多排的课可以直接删掉，不留记录</span>
          <button className="btn sm" style={{ color: 'var(--danger-ink)' }} disabled={busy} onClick={remove}>删除这节课</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </Modal>
  );
}
