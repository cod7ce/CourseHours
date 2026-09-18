import { Outlet, useNavigate } from 'react-router';
import { useEffect } from 'react';
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
    return () => window.removeEventListener('keydown', h);
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
