import { Outlet, useNavigate } from 'react-router';
import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './Sidebar';
import { usePrivacy, useRunNewAction } from './ui';

export function Shell() {
  const nav = useNavigate();
  const { hidden } = usePrivacy();
  const runNew = useRunNewAction();
  useEffect(() => {
    const NAV = ['/', '/schedule', '/students', '/classes', '/ledger', '/reports'];
    const h = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === ',') { e.preventDefault(); nav('/settings/rules'); return; }
      if (e.key === 'f' || e.key === '/') {
        const el = document.querySelector<HTMLInputElement>('input[data-search]');
        if (el) { e.preventDefault(); el.focus(); el.select(); }
        return;
      }
      // ⌘N：当前页的「新建」；弹窗开着时不抢
      if (e.key === 'n' && !document.querySelector('.overlay')) { e.preventDefault(); runNew(); return; }
      // ⌘1–⌘6：切主页面
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length && !document.querySelector('.overlay')) { e.preventDefault(); nav(NAV[n - 1]); }
    };
    window.addEventListener('keydown', h);
    // 窗口拖动：侧边栏、页面顶栏的空白处按下即拖（Tauri 不支持 -webkit-app-region）
    const drag = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('button, a, input, select, textarea, label, [role="button"], .no-drag')) return;
      if (!t.closest('.drag')) return;
      e.preventDefault();
      if (e.detail === 2) { getCurrentWindow().toggleMaximize().catch(() => {}); return; }
      getCurrentWindow().startDragging().catch(() => {});
    };
    document.addEventListener('mousedown', drag);
    return () => { window.removeEventListener('keydown', h); document.removeEventListener('mousedown', drag); };
  }, [nav, runNew]);
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Outlet key={hidden ? 'money-hidden' : 'money-shown'} />
      </div>
    </div>
  );
}
