import { NavLink, useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getNavStats, type NavStats } from '../lib/api';
import { num } from '../lib/format';
import { usePrivacy, useRefresh } from './ui';
import { IconCalendar, IconChart, IconClock, IconEye, IconEyeOff, IconGear, IconGrid, IconList, IconStudents } from './icons';

const items = [
  { to: '/', label: '今日', icon: IconClock, end: true },
  { to: '/schedule', label: '课表', icon: IconCalendar },
  { to: '/students', label: '学生', icon: IconStudents },
  { to: '/classes', label: '班级', icon: IconGrid },
  { to: '/ledger', label: '课时流水', icon: IconList },
  { to: '/reports', label: '经营报表', icon: IconChart },
];

export function Sidebar() {
  const [stats, setStats] = useState<NavStats | null>(null);
  const { tick } = useRefresh();
  const loc = useLocation();
  useEffect(() => { getNavStats().then(setStats).catch(() => {}); }, [tick, loc.pathname]);
  const onSettings = loc.pathname.startsWith('/settings');
  const privacy = usePrivacy();
  const [hasUpdate, setHasUpdate] = useState(false);
  useEffect(() => { let un: (() => void) | undefined; listen('update-available', () => setHasUpdate(true)).then((f) => { un = f; }); return () => un?.(); }, []);
  return (
    <aside className="drag" style={{ width: 216, flexShrink: 0, background: 'var(--nav-bg)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ height: 28 }} />
      <div style={{ padding: '18px 18px 22px' }}>
        <img src="/logo.jpg" alt="" width={52} height={52} draggable={false}
          style={{ display: 'block', borderRadius: '50%', objectFit: 'cover', boxShadow: '0 0 0 2px var(--nav-line)', marginBottom: 12 }} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--nav-brand)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stats?.orgName || '课时统计'}</div>
        <div style={{ fontSize: 10.5, color: 'var(--nav-text-dim)', letterSpacing: '0.16em', marginTop: 6 }}>COURSE HOURS</div>
      </div>
      <nav className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px' }}>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 11, height: 38, padding: '0 12px', borderRadius: 9,
            background: isActive ? 'var(--accent)' : 'transparent', color: isActive ? 'var(--nav-text-on)' : 'var(--nav-text)', fontSize: 13.5,
          })}>
            <Icon />
            <span style={{ flexGrow: 1 }}>{label}</span>
            {to === '/' && stats && stats.todayPending > 0 && <span className="num" style={{ fontSize: 12, opacity: .85 }}>{stats.todayPending}</span>}
            {to === '/students' && stats && stats.owedCount > 0 && <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 8, background: 'var(--nav-card-warn)', color: 'var(--nav-warn-text)' }}>{stats.owedCount} 欠</span>}
          </NavLink>
        ))}
      </nav>
      <div style={{ flexGrow: 1 }} />
      <div style={{ margin: '0 12px 10px', padding: '13px 14px', borderRadius: 10, background: 'var(--nav-card)' }}>
        <div style={{ fontSize: 11, color: 'var(--nav-text-dim)' }}>本月课消</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
          <span className="num" style={{ fontSize: 23, fontWeight: 600, color: 'var(--nav-brand)' }}>{stats ? num(stats.monthConsumedHours) : '—'}</span>
          <span style={{ fontSize: 11.5, color: 'var(--nav-text-dim)' }}>课时</span>
        </div>
      </div>
      <div className="no-drag" style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--nav-line)' }}>
        <button type="button" disabled={privacy.busy} onClick={() => { void privacy.toggle(); }} title={privacy.hidden ? '验证后显示金额，当天有效，隔天自动隐藏' : '点击隐藏金额'} style={{
          display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 36, padding: '0 12px', border: 0, borderRadius: 9, fontSize: 13, cursor: 'pointer',
          background: privacy.hidden ? 'var(--nav-card)' : 'transparent', color: privacy.hidden ? 'var(--nav-text-on)' : 'var(--nav-text-dim)', textAlign: 'left',
        }}>
          {privacy.hidden ? <IconEyeOff /> : <IconEye />}<span>{privacy.hidden ? '显示金额' : '金额今日可见'}</span>
        </button>
        <NavLink to="/settings/rules" style={{
          display: 'flex', alignItems: 'center', gap: 11, height: 36, padding: '0 12px', borderRadius: 9, fontSize: 13,
          background: onSettings ? 'var(--nav-card)' : 'transparent', color: onSettings ? 'var(--nav-text-on)' : 'var(--nav-text-dim)',
        }}>
          <IconGear /><span>设置</span>
          {hasUpdate && <span title="有新版本" style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
        </NavLink>
      </div>
    </aside>
  );
}
