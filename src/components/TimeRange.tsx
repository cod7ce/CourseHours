import { useCallback, useState } from 'react';
import { fromMinutes, TimePicker, toMinutes } from './pickers';

/** 'HH:MM' 加减分钟，钳在 00:00–23:59 */
export function addMinutes(time: string, mins: number): string {
  if (!time) return time;
  return fromMinutes(toMinutes(time) + mins);
}

/**
 * 开始 / 结束时间联动：改一头，另一头按班级「单次时长」自动算。
 */
export function useLinkedTime(initialStart: string, initialEnd: string, durationMin: number) {
  const [start, setStartRaw] = useState(initialStart);
  const [end, setEndRaw] = useState(initialEnd);
  const setStart = useCallback((v: string) => {
    setStartRaw(v);
    if (v) setEndRaw(addMinutes(v, durationMin));
  }, [durationMin]);
  const setEnd = useCallback((v: string) => {
    setEndRaw(v);
    if (v) setStartRaw(addMinutes(v, -durationMin));
  }, [durationMin]);
  const setBoth = useCallback((s: string, e: string) => { setStartRaw(s); setEndRaw(e); }, []);
  return { start, end, setStart, setEnd, setBoth };
}

export function TimeRangeFields({ start, end, onStart, onEnd, durationMin, hint = true }: {
  start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void; durationMin: number; hint?: boolean;
}) {
  return (
    <div className="field">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>开始</label>
          <TimePicker value={start} onChange={onStart} />
        </div>
        <div className="field">
          <label>结束</label>
          <TimePicker value={end} onChange={onEnd} />
        </div>
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>按单次时长 <span className="num">{durationMin}</span> 分钟联动，改一头另一头自动算</div>}
    </div>
  );
}
