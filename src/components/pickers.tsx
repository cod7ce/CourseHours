import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconBack, IconNext } from './icons';
import { addDays, todayStr } from '../lib/format';

// ---------- Popover（portal 到 body，避免被弹窗的 overflow 裁掉） ----------
function Popover({ anchor, onClose, children, width }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 260;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({ top, left });
  }, [anchor, width]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} style={{
      position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, zIndex: 200,
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12,
      boxShadow: '0 12px 32px -12px rgba(60, 30, 10, .35)', padding: 10, userSelect: 'none',
    }}>{children}</div>,
    document.body,
  );
}

const fieldStyle = (h: number): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: h, padding: '0 12px', width: '100%',
  border: '1px solid var(--line-ctrl)', borderRadius: 9, background: 'var(--surface-input)', color: 'var(--ink)',
  fontFamily: 'var(--font-display)', fontSize: 14, cursor: 'pointer', textAlign: 'left',
});

// ---------- TimePicker ----------
export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function fromMinutes(min: number): string {
  const v = Math.max(0, Math.min(23 * 60 + 59, min));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/**
 * 时间选择：点开是「小时 × 分钟」两栏，分钟按 step（默认 15）分格；
 * 聚焦时 ↑↓ 按 step 微调。值是 'HH:MM'。
 */
export function TimePicker({ value, onChange, step = 15, minHour = 7, maxHour = 22, height = 36, disabled }: {
  value: string; onChange: (v: string) => void; step?: number; minHour?: number; maxHour?: number; height?: number; disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = toMinutes(value || '00:00');
  const curH = Math.floor(cur / 60);
  const curM = cur % 60;
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => minHour + i);
  const mins = Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step);
  const pick = (h: number, m: number) => onChange(fromMinutes(h * 60 + m));
  return (
    <>
      <button ref={btn} type="button" disabled={disabled} style={fieldStyle(height)} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(fromMinutes(cur + step)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(fromMinutes(cur - step)); }
        }}>
        <span>{value || '--:--'}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-body)' }}>▾</span>
      </button>
      {open && btn.current && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={236}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '2px 4px 6px' }}>时</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                {hours.map((h) => (
                  <Cell key={h} on={h === curH} onClick={() => pick(h, curM)}>{String(h).padStart(2, '0')}</Cell>
                ))}
              </div>
            </div>
            <div style={{ width: 1, background: 'var(--line-faint)' }} />
            <div style={{ width: 52 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '2px 4px 6px' }}>分</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                {mins.map((m) => (
                  <Cell key={m} on={m === curM} onClick={() => { pick(curH, m); setOpen(false); }}>{String(m).padStart(2, '0')}</Cell>
                ))}
              </div>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

function Cell({ on, onClick, children, muted, today }: { on: boolean; onClick: () => void; children: ReactNode; muted?: boolean; today?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="num" style={{
      height: 30, border: 0, borderRadius: 7, cursor: 'pointer', fontSize: 13,
      background: on ? 'var(--accent)' : 'transparent',
      color: on ? 'var(--nav-text-on)' : muted ? 'var(--ink-4)' : 'var(--ink)',
      fontWeight: on || today ? 600 : 400,
      boxShadow: today && !on ? 'inset 0 0 0 1px var(--accent)' : undefined,
    }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--surface-sunk)'; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

// ---------- DatePicker ----------
const WD = ['一', '二', '三', '四', '五', '六', '日'];

export function fmtCnDate(d: string): string {
  if (!d) return '选择日期';
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(y, m - 1, day).getDay();
  return `${y} 年 ${m} 月 ${day} 日 · 周${WD[(wd + 6) % 7]}`;
}

/** 日期选择：日历弹层，周一起，今天描边，选中实心。值是 'YYYY-MM-DD'，可清空时传 allowEmpty。 */
export function DatePicker({ value, onChange, height = 36, allowEmpty, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; height?: number; allowEmpty?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const base = value || today;
  const [view, setView] = useState(base.slice(0, 7));
  useEffect(() => { if (open) setView(base.slice(0, 7)); }, [open, base]);

  const [vy, vm] = view.split('-').map(Number);
  const first = `${view}-01`;
  const firstWd = (new Date(vy, vm - 1, 1).getDay() + 6) % 7; // 周一=0
  const gridStart = addDays(first, -firstWd);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const shift = (d: number) => {
    const t = vy * 12 + (vm - 1) + d;
    setView(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  };

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} style={fieldStyle(height)} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!value) return;
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(addDays(value, -1)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(addDays(value, 1)); }
        }}>
        <span style={{ color: value ? 'var(--ink)' : 'var(--ink-4)' }}>{value ? fmtCnDate(value) : (placeholder ?? '选择日期')}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-body)' }}>▾</span>
      </button>
      {open && btn.current && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={272}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 8px' }}>
            <button type="button" aria-label="上个月" onClick={() => shift(-1)} style={navBtn}><IconBack size={13} /></button>
            <span className="num" style={{ fontSize: 14, fontWeight: 600 }}>{vy} 年 {vm} 月</span>
            <button type="button" aria-label="下个月" onClick={() => shift(1)} style={navBtn}><IconNext size={13} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {WD.map((w, i) => <span key={w} style={{ textAlign: 'center', fontSize: 11, color: i >= 5 ? 'var(--accent-deep)' : 'var(--ink-3)', padding: '2px 0 4px' }}>{w}</span>)}
            {cells.map((d) => (
              <Cell key={d} on={d === value} today={d === today} muted={!d.startsWith(view)} onClick={() => { onChange(d); setOpen(false); }}>
                {Number(d.slice(8))}
              </Cell>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, marginTop: 6, borderTop: '1px solid var(--line-faint)' }}>
            <button type="button" className="btn sm" onClick={() => { onChange(today); setOpen(false); }}>今天</button>
            {allowEmpty && <button type="button" className="btn sm ghost" onClick={() => { onChange(''); setOpen(false); }}>清空</button>}
          </div>
        </Popover>
      )}
    </>
  );
}

const navBtn: React.CSSProperties = { width: 28, height: 28, border: '1px solid var(--line-ctrl)', borderRadius: 7, background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' };
