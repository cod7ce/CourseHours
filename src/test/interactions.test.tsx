/**
 * 交互测试：模拟真实操作，断言界面算得对、发给后端的数据也对。
 * 与 routes.test.tsx 的区别：那边只保证「渲染不崩」，这边保证「行为正确」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

import { calls, lastCall, resetCalls, RESPONSES, setResponse, TODAY } from './tauri-mock';
import { renderAt } from './render';

const errors: string[] = [];
beforeEach(() => {
  errors.length = 0;
  resetCalls();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(String(a[0])); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const noRenderError = () => expect(errors, errors.join('\n')).toHaveLength(0);
/** 金额默认是遮住的，要看真实数字的用例先解锁 */
const showMoney = () => localStorage.setItem('privacy:money-shown-on', TODAY);
/** 弹窗底部的按钮（页面上可能有同名按钮） */
const footer = () => within(document.querySelector('.modal-foot') as HTMLElement);

/** 点名页：st1 林小满（付费，余额 −2），st2 小朋友（免费，余额 0） */
describe('点名', () => {
  const open = async () => {
    renderAt('/sessions/s1/roll-call');
    await waitFor(() => expect(screen.getByText('本次共扣')).toBeTruthy(), { timeout: 4000 });
  };
  const total = () => screen.getByText('本次共扣').parentElement!.querySelector('.num')!.textContent;
  const row = (name: string) => screen.getByText(name).closest('div[style]')!.parentElement!.parentElement!;

  it('默认全部出勤，免费学员不计入合计', async () => {
    await open();
    // 付费生扣 1，免费生扣 0
    expect(total()).toBe('1');
    noRenderError();
  });

  it('改成请假后合计变 0，扣后余额不变', async () => {
    await open();
    fireEvent.click(within(row('林小满')).getByText('请假'));
    await waitFor(() => expect(total()).toBe('0'));
    noRenderError();
  });

  it('免费学员那一行始终显示「免费」，不出现欠课时标签', async () => {
    await open();
    const free = row('小朋友');
    expect(within(free).getByText('免费')).toBeTruthy();
    fireEvent.click(within(free).getByText('出勤'));
    expect(total()).toBe('1');
    expect(within(free).queryByText(/欠/)).toBeNull();
  });

  it('付费生扣后为负会标出欠课时', async () => {
    await open();
    expect(within(row('林小满')).getAllByText(/欠/).length).toBeGreaterThan(0);
  });

  it('「全部标记出勤」把改过的状态清回出勤', async () => {
    await open();
    fireEvent.click(within(row('林小满')).getByText('缺勤'));
    await waitFor(() => expect(total()).toBe('0'));
    fireEvent.click(screen.getByText('全部标记出勤'));
    await waitFor(() => expect(total()).toBe('1'));
  });

  it('确认扣课时把每个人的状态发给后端', async () => {
    await open();
    fireEvent.click(within(row('林小满')).getByText('迟到'));
    fireEvent.click(screen.getByText(/确认扣课时/));
    await waitFor(() => expect(lastCall('confirm_rollcall')).toBeTruthy());
    const args = lastCall('confirm_rollcall')!.args as { sessionId: string; marks: { studentId: string; status: string }[] };
    expect(args.sessionId).toBe('s1');
    expect(args.marks).toEqual([
      { studentId: 'st1', status: 'late' },
      { studentId: 'st2', status: 'present' },
    ]);
    noRenderError();
  });

  it('⌘回车等同于点确认', async () => {
    await open();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(lastCall('confirm_rollcall')).toBeTruthy());
  });

  it('数字键 1/2/3/4 给当前行打状态', async () => {
    await open();
    fireEvent.keyDown(window, { key: '3' }); // 第一行 → 请假
    await waitFor(() => expect(total()).toBe('0'));
  });
});

describe('登记充值', () => {
  const open = async () => {
    showMoney();
    renderAt('/students/st1/recharge');
    await waitFor(() => expect(screen.getByText('登记充值')).toBeTruthy(), { timeout: 4000 });
  };
  const qtyInput = () => screen.getByText('课次', { selector: 'span' }).parentElement!.querySelector('input')!;

  it('课次与金额算出折合单价', async () => {
    await open();
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '1500' } });
    await waitFor(() => expect(screen.getAllByText('¥150 / 次').length).toBeGreaterThan(0));
    noRenderError();
  });

  it('余额为负时给出两种欠课时处理方式', async () => {
    await open();
    expect(screen.getByText(/从本次充值中抵扣/)).toBeTruthy();
    expect(screen.getByText(/欠款另行补缴/)).toBeTruthy();
  });

  it('提交时把课次、金额（分）、方式发给后端', async () => {
    await open();
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '1500' } });
    await waitFor(() => expect(screen.getAllByText('¥150 / 次').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText(/确认充值/));
    await waitFor(() => expect(lastCall('recharge')).toBeTruthy());
    const input = (lastCall('recharge')!.args as { input: Record<string, unknown> }).input;
    expect(input.studentId).toBe('st1');
    expect(input.sessions).toBe(10);
    expect(input.amountCents).toBe(150000);
    expect(input.mode).toBe('offset');
  });

  it('切成「欠款另行补缴」后 mode 变 cash', async () => {
    await open();
    fireEvent.click(screen.getByText(/欠款另行补缴/));
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: '10' } });
    fireEvent.change(inputs[1], { target: { value: '1500' } });
    fireEvent.click(screen.getByText(/确认充值/));
    await waitFor(() => expect(lastCall('recharge')).toBeTruthy());
    const input = (lastCall('recharge')!.args as { input: Record<string, unknown> }).input;
    expect(input.mode).toBe('cash');
  });

  void qtyInput;
});

describe('学生列表', () => {
  it('切筛选会带上 filter 重新查', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/已欠课时/));
    await waitFor(() => expect((lastCall('list_students')!.args as { filter: string }).filter).toBe('owed'));
    noRenderError();
  });

  it('免费学员在列表里显示「免费」而不是余额数字', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getByText('小朋友')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getAllByText('免费').length).toBeGreaterThan(0);
  });
});

describe('新建与连续新建', () => {
  it('保存并继续：不关弹窗、清空姓名、把数据发给后端', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/新增学生/));
    const name = await screen.findByPlaceholderText('学生姓名');
    fireEvent.change(name, { target: { value: '张三' } });
    fireEvent.click(screen.getByText(/保存并继续/));
    await waitFor(() => expect(lastCall('create_student')).toBeTruthy());
    const input = (lastCall('create_student')!.args as { input: Record<string, unknown> }).input;
    expect(input.name).toBe('张三');
    expect(input.billing).toBe('paid');
    // 弹窗还开着，姓名已清空
    await waitFor(() => expect((screen.getByPlaceholderText('学生姓名') as HTMLInputElement).value).toBe(''));
    noRenderError();
  });

  it('打开免费学员开关后 billing 是 free', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/新增学生/));
    const name = await screen.findByPlaceholderText('学生姓名');
    fireEvent.change(name, { target: { value: '我儿子' } });
    fireEvent.click(screen.getByLabelText('免费学员'));
    fireEvent.click(footer().getByText('新增'));
    await waitFor(() => expect(lastCall('create_student')).toBeTruthy());
    expect((lastCall('create_student')!.args as { input: Record<string, unknown> }).input.billing).toBe('free');
  });

  it('姓名为空时不提交，给出提示', async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText(/新增学生/));
    await screen.findByPlaceholderText('学生姓名');
    fireEvent.click(footer().getByText('新增'));
    await waitFor(() => expect(screen.getByText('姓名不能为空')).toBeTruthy());
    expect(lastCall('create_student')).toBeUndefined();
  });
});

describe('弹窗快捷键', () => {
  const openStudentForm = async () => {
    renderAt('/students');
    await waitFor(() => expect(screen.getAllByText('学生').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.keyDown(window, { key: 'n', metaKey: true }); // ⌘N 打开
    return screen.findByPlaceholderText('学生姓名');
  };

  it('⌘N 打开新建弹窗', async () => {
    await openStudentForm();
    expect(screen.getByText(/保存并继续/)).toBeTruthy();
  });

  it('回车提交，⌘回车保存并继续', async () => {
    const name = await openStudentForm();
    fireEvent.change(name, { target: { value: '李四' } });
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(lastCall('create_student')).toBeTruthy());
    await waitFor(() => expect((screen.getByPlaceholderText('学生姓名') as HTMLInputElement).value).toBe(''));

    resetCalls();
    fireEvent.change(screen.getByPlaceholderText('学生姓名'), { target: { value: '王五' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(lastCall('create_student')).toBeTruthy());
    // 普通回车 = 提交并关闭
    await waitFor(() => expect(screen.queryByPlaceholderText('学生姓名')).toBeNull());
  });

  it('输入法组字中的回车不提交', async () => {
    const name = await openStudentForm();
    fireEvent.change(name, { target: { value: '赵六' } });
    fireEvent.compositionStart(name);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(lastCall('create_student')).toBeUndefined();
    // 候选词上屏后紧接着的回车也忽略（部分输入法先发 compositionend 再发 keydown）
    fireEvent.compositionEnd(name);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(lastCall('create_student')).toBeUndefined();
  });

  it('Esc 关闭弹窗', async () => {
    await openStudentForm();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText('学生姓名')).toBeNull());
  });
});

describe('隐藏金额', () => {
  it('默认遮住金额，验证通过后显示', async () => {
    renderAt('/reports');
    await waitFor(() => expect(screen.getAllByText('经营报表').length).toBeGreaterThan(0), { timeout: 4000 });
    expect(screen.getAllByText('∗∗∗∗∗').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('显示金额'));
    await waitFor(() => expect(lastCall('authenticate')).toBeTruthy());
    await waitFor(() => expect(screen.queryAllByText('∗∗∗∗∗')).toHaveLength(0));
    expect(screen.getByText('金额今日可见')).toBeTruthy();
    noRenderError();
  });

  it('验证被取消就继续遮住', async () => {
    setResponse('authenticate', { ok: false, unavailable: false, message: '用户取消' });
    renderAt('/reports');
    await waitFor(() => expect(screen.getAllByText('经营报表').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getByText('显示金额'));
    await waitFor(() => expect(lastCall('authenticate')).toBeTruthy());
    expect(screen.getAllByText('∗∗∗∗∗').length).toBeGreaterThan(0);
  });
});

describe('课表', () => {
  it('拖动课块按 15 分钟吸附并保存', async () => {
    renderAt('/schedule');
    const block = await screen.findByTitle(/Movers B 班 14:00/, undefined, { timeout: 4000 });
    fireEvent.mouseDown(block, { button: 0, clientX: 100, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 313 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 326 }); // 下移 26px = 2 格 = 30 分钟
    fireEvent.mouseUp(document, { clientX: 100, clientY: 326 });
    await waitFor(() => expect(lastCall('update_session')).toBeTruthy());
    const patch = (lastCall('update_session')!.args as { patch: { startTime: string; endTime: string } }).patch;
    expect(patch.startTime).toBe('14:30');
    expect(patch.endTime).toBe('16:00');
    noRenderError();
  });

  it('翻周会带上新的日期重新查', async () => {
    renderAt('/schedule');
    await waitFor(() => expect(screen.getAllByText('课表').length).toBeGreaterThan(0), { timeout: 4000 });
    const before = (lastCall('list_sessions')!.args as { date: string }).date;
    fireEvent.click(screen.getByLabelText('下一周'));
    await waitFor(() => expect((lastCall('list_sessions')!.args as { date: string }).date).not.toBe(before));
  });
});

describe('设置', () => {
  it('改了才允许保存，保存时把整份设置发给后端', async () => {
    renderAt('/settings/rules');
    await waitFor(() => expect(screen.getByText('已是最新')).toBeTruthy(), { timeout: 4000 });
    const saveBtn = screen.getByText(/保存设置/).closest('button')!;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.click(screen.getAllByLabelText('增加')[0]); // 出勤扣课时 +1
    await waitFor(() => expect(screen.getByText('有未保存的改动')).toBeTruthy());
    fireEvent.click(saveBtn);
    await waitFor(() => expect(lastCall('save_settings')).toBeTruthy());
    const sent = (lastCall('save_settings')!.args as { settingsValue: { hoursRule: { present: number } } }).settingsValue;
    expect(sent.hoursRule.present).toBe(2);
    noRenderError();
  });

  it('「放弃改动」回到已保存的值', async () => {
    renderAt('/settings/rules');
    await waitFor(() => expect(screen.getByText('已是最新')).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getAllByLabelText('增加')[0]);
    await waitFor(() => expect(screen.getByText('有未保存的改动')).toBeTruthy());
    fireEvent.click(screen.getByText('放弃改动'));
    await waitFor(() => expect(screen.getByText('已是最新')).toBeTruthy());
  });
});

describe('导航快捷键', () => {
  it('⌘2 切到课表，⌘3 切到学生', async () => {
    renderAt('/');
    await waitFor(() => expect(screen.getAllByText('今日').length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    await waitFor(() => expect(screen.getAllByText('课表').length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    await waitFor(() => expect(screen.getAllByText(/人在读/).length).toBeGreaterThan(0));
    noRenderError();
  });
});

void RESPONSES;
void calls;
