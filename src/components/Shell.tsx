import { Outlet, useNavigate } from 'react-router';
import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './Sidebar';

export function Shell() {
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') { e.preventDefault(); nav('/settings/rules'); }
      if (e.metaKey && e.key === 'f') {
        const el = document.querySelector<HTMLInputElement>('input[data-search]');
        if (el) { e.preventDefault(); el.focus(); el.select(); }
      }
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
  }, [nav]);
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
