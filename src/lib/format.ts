/** 全局「隐藏金额」开关（由 PrivacyProvider 维护），开启后 yuan() 一律返回遮罩 */
let moneyHidden = false;
export function setMoneyHidden(v: boolean) { moneyHidden = v; }
export function isMoneyHidden() { return moneyHidden; }
export const MONEY_MASK = '*****';

/** 金额：分 → ¥1,000 / ¥14,286.50 / −¥300；隐藏时 ¥••• */
export function yuan(cents: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (cents == null) return '—';
  if (moneyHidden) return MONEY_MASK;
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const y = Math.floor(abs / 100);
  const f = abs % 100;
  const body = y.toLocaleString('en-US') + (f ? '.' + String(f).padStart(2, '0') : '');
  if (neg) return '−¥' + body;
  return (opts.sign ? '+' : '') + '¥' + body;
}

/** 课时数：去掉多余小数，负号用 U+2212 */
export function num(v: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v == null) return '—';
  const s = Number.isInteger(v) ? String(Math.abs(v)) : String(Math.abs(Math.round(v * 100) / 100));
  if (v < 0) return '−' + s;
  if (opts.sign && v > 0) return '+' + s;
  return s;
}

export function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return Math.round(v * 100) + '%';
}

/** 'YYYY-MM-DD' → 'MM-DD' */
export function md(date: string): string {
  return date.slice(5);
}

/** 'YYYY-MM-DD' → '9 月 17 日' */
export function cnDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 'YYYY-MM-DD' → '2026 年 9 月 17 日' */
export function cnFullDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

/** 'YYYY-MM' → '2026 年 9 月' */
export function cnMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

export function weekdayCn(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
}

/** 毫秒时间戳 → 'MM-DD HH:MM' */
export function dt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dateOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayStr(): string {
  return dateOf(Date.now());
}

export function thisMonth(): string {
  return todayStr().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateOf(d.getTime());
}

export function statusLabel(s: string): string {
  return ({ present: '出勤', late: '迟到', leave: '请假', absent: '缺勤' } as Record<string, string>)[s] ?? s;
}

export function methodLabel(m: string | null | undefined): string {
  if (!m) return '';
  return ({ wechat: '微信', alipay: '支付宝', cash: '现金', transfer: '转账' } as Record<string, string>)[m] ?? m;
}

export function studentStatusLabel(s: string): string {
  return ({ active: '在读', paused: '已停课', left: '已退班' } as Record<string, string>)[s] ?? s;
}

export function initial(name: string): string {
  return name.trim().charAt(0);
}

export function bytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** 班级色 → 浅底 / 线色（课表色块用） */
export function classTone(color: string): { soft: string; line: string } {
  const map: Record<string, [string, string]> = {
    '#B75E36': ['#F9EAE0', '#E6C6B2'],
    '#4C6F55': ['#E9F0E8', '#C6D6C4'],
    '#3F6B6E': ['#E3EDED', '#BFD5D5'],
    '#8C4A63': ['#F5E7EC', '#DEC3CE'],
    '#92701F': ['#F6EDD8', '#E2D0A8'],
    '#8C8276': ['#F1EADE', '#DCD1BD'],
  };
  const hit = map[color.toUpperCase()];
  if (hit) return { soft: hit[0], line: hit[1] };
  return { soft: color + '1A', line: color + '55' };
}

export const CLASS_COLORS = ['#B75E36', '#4C6F55', '#3F6B6E', '#8C4A63', '#92701F', '#8C8276'];
