import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { IconBack, IconMinus, IconPlus } from './icons';
import { setMoneyHidden, todayStr } from '../lib/format';

// ---------- Toast ----------
type ToastKind = 'info' | 'ok' | 'danger';
interface Toast { id: number; text: string; kind: ToastKind }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Confirm ----------
interface ConfirmOpts { title: string; body?: ReactNode; confirmText?: string; danger?: boolean }
type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)} width={440}
          footer={<>
            <button className="btn" onClick={() => close(false)}>取消</button>
            <button className={`btn ${state.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{state.confirmText ?? '确认'}</button>
          </>}>
          {state.body && <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{state.body}</div>}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ title, sub, children, footer, onClose, width = 520 }: {
  title: string; sub?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose: () => void; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- 小件 ----------
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className={`switch ${on ? 'on' : ''}`} aria-label={label}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
    </label>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, format }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="stepper">
      <button type="button" aria-label="减少" onClick={() => set(value - step)} disabled={value <= min}><IconMinus size={13} /></button>
      <span className="val">{format ? format(value) : value}</span>
      <button type="button" aria-label="增加" onClick={() => set(value + step)} disabled={value >= max}><IconPlus size={13} /></button>
    </div>
  );
}

export function Pill({ kind, children, round, style }: { kind: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent'; children: ReactNode; round?: boolean; style?: React.CSSProperties }) {
  return <span className={`pill ${kind} ${round ? 'round' : ''}`} style={style}>{children}</span>;
}

export function Avatar({ name, tone, size = 32 }: { name: string; tone?: 'danger' | 'warn'; size?: number }) {
  return <span className={`avatar ${tone ?? ''}`} style={{ width: size, height: size, fontSize: size * 0.44 }}>{name.trim().charAt(0)}</span>;
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="t">{title}</div>{hint && <div>{hint}</div>}{action}</div>;
}

export function Loading() {
  return <div className="loading"><div className="spin" /></div>;
}

export function PageHeader({ title, sub, crumb, right }: { title: ReactNode; sub?: ReactNode; crumb?: { to: string; label: string }; right?: ReactNode }) {
  return (
    <header className="page-header drag">
      <div>
        {crumb && <Link className="crumb" to={crumb.to}><IconBack />{crumb.label}</Link>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{right}</div>}
    </header>
  );
}

export function Num({ v, size = 17, weight = 600, color, className, style }: { v: ReactNode; size?: number; weight?: number; color?: string; className?: string; style?: React.CSSProperties }) {
  return <span className={`num ${className ?? ''}`} style={{ fontSize: size, fontWeight: weight, color, ...style }}>{v}</span>;
}

/** 余额颜色：负=红，≤阈值=黄，否则墨色 */
export function balanceColor(b: number, threshold = 3): string {
  if (b < 0) return 'var(--danger)';
  if (b <= threshold) return 'var(--warn)';
  return 'var(--ink)';
}

// ---------- 异步 ----------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const t = setTimeout(() => { if (alive.current) setLoading(true); }, 200);
    fn().then((d) => { if (alive.current) { setData(d); setError(null); } })
      .catch((e) => { if (alive.current) setError(typeof e === 'string' ? e : String(e)); })
      .finally(() => { clearTimeout(t); if (alive.current) setLoading(false); });
    return () => { alive.current = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return useMemo(() => ({ data, error, loading, reload }), [data, error, loading, reload]);
}

/** 全局刷新信号：写操作后通知侧边栏等重新拉数据 */
const RefreshCtx = createContext<{ tick: number; bump: () => void }>({ tick: 0, bump: () => {} });
export const useRefresh = () => useContext(RefreshCtx);
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((x) => x + 1), []);
  const v = useMemo(() => ({ tick, bump }), [tick, bump]);
  return <RefreshCtx.Provider value={v}>{children}</RefreshCtx.Provider>;
}

/** 隐藏金额：默认隐藏；点开后当天有效（记住「哪天打开的」），隔天自动回到隐藏。切换时整棵页面树重挂载以刷新所有 yuan() */
const PrivacyCtx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: true, toggle: () => {} });
export const usePrivacy = () => useContext(PrivacyCtx);
const PRIVACY_KEY = 'privacy:money-shown-on';
function shownToday(): boolean {
  try { return localStorage.getItem(PRIVACY_KEY) === todayStr(); } catch { return false; }
}
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<boolean>(() => { const v = !shownToday(); setMoneyHidden(v); return v; });
  const toggle = useCallback(() => {
    setHidden((h) => {
      const v = !h;
      setMoneyHidden(v);
      try { if (v) localStorage.removeItem(PRIVACY_KEY); else localStorage.setItem(PRIVACY_KEY, todayStr()); } catch { /* ignore */ }
      return v;
    });
  }, []);
  // 跨过午夜自动回到隐藏
  useEffect(() => {
    const t = setInterval(() => {
      if (!shownToday()) { setMoneyHidden(true); setHidden(true); }
    }, 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>;
}
