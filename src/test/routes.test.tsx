/**
 * 冒烟测试：把每一屏真渲染一遍（Tauri 调用走假数据），页面崩了就红。
 * 专门用来接住 hooks 顺序、空数据、字段改名这类 TypeScript 查不出的运行时错误。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock 会被提升到 import 之前，所以必须写在测试文件顶层，且工厂里只能用动态 import
vi.mock('@tauri-apps/api/core', async () => {
  const { fakeInvoke } = await import('./tauri-mock');
  return { invoke: (cmd: string, args?: Record<string, unknown>) => fakeInvoke(cmd, args) };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: () => Promise.resolve(), toggleMaximize: () => Promise.resolve() }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: () => Promise.resolve(null), open: () => Promise.resolve(null) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: () => Promise.resolve(), revealItemInDir: () => Promise.resolve() }));
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { invoked } from './tauri-mock';
import { renderAt } from './render';

const SCREENS: { path: string; heading: string | RegExp }[] = [
  { path: '/', heading: '今日' },
  { path: '/schedule', heading: '课表' },
  { path: '/schedule/planning', heading: '排课' },
  { path: '/students', heading: '学生' },
  { path: '/students/st1', heading: /林小满/ },
  { path: '/students/st1/recharge', heading: '登记充值' },
  { path: '/classes', heading: '班级' },
  { path: '/classes/k1', heading: /Movers B 班/ },
  { path: '/sessions/s1/roll-call', heading: /点名/ },
  { path: '/ledger', heading: '课时流水' },
  { path: '/reports', heading: '经营报表' },
  { path: '/settings/rules', heading: '设置' },
];

describe('每一屏都能渲染', () => {
  let errors: string[] = [];
  beforeEach(() => {
    errors = [];
    // React 的渲染错误只打到 console.error，不会让测试失败，所以自己收集
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  for (const { path, heading } of SCREENS) {
    it(path, async () => {
      renderAt(path);
      await waitFor(() => {
        expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
      }, { timeout: 4000 });
      expect(errors, errors.join('\n')).toHaveLength(0);
    });
  }

  it('设置的五个分区都能切', async () => {
    for (const s of ['rules', 'alerts', 'packs', 'org', 'data', 'version']) {
      cleanup();
      renderAt(`/settings/${s}`);
      await waitFor(() => expect(screen.getAllByText('设置').length).toBeGreaterThan(0), { timeout: 4000 });
      expect(errors, `${s}: ${errors.join('\n')}`).toHaveLength(0);
    }
  });

  it('课表翻周会重新取数，且不崩', async () => {
    renderAt('/schedule');
    await waitFor(() => expect(screen.getAllByText('课表').length).toBeGreaterThan(0), { timeout: 4000 });
    const before = invoked.filter((c) => c === 'list_sessions').length;
    fireEvent.click(screen.getByLabelText('下一周'));
    await waitFor(() => expect(invoked.filter((c) => c === 'list_sessions').length).toBeGreaterThan(before));
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  it('新增学生弹窗能打开', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/新增学生/));
    await waitFor(() => expect(screen.getByPlaceholderText('学生姓名')).toBeTruthy());
    expect(screen.getAllByText('免费学员').length).toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  it('新建班级弹窗能打开', async () => {
    renderAt('/classes');
    await waitFor(() => expect(screen.getAllByText('班级').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getAllByText(/新建班级/)[0]);
    await waitFor(() => expect(screen.getByPlaceholderText(/Movers B 班/)).toBeTruthy());
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  it('临时加课弹窗能打开', async () => {
    renderAt('/schedule');
    await waitFor(() => expect(screen.getAllByText('课表').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/临时加课/));
    await waitFor(() => expect(screen.getByText('添加课次')).toBeTruthy());
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
