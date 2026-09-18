import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import * as api from '../lib/api';
import type { Adjustment, RuleRow } from '../lib/api';
import { cnDate, dateOf, md } from '../lib/format';
import { ExtraSessionModal } from '../components/ExtraSessionModal';
import { ClassScheduleModal } from '../components/ScheduleEditor';
import { Modal } from '../components/ui';
import { IconCheck, IconInfo } from '../components/icons';
import { Loading, PageHeader, Stepper, Switch, useAsync, useConfirm, useRefresh, useToast } from '../components/ui';

const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function dow(date: string): string {
  return DOW[new Date(date + 'T00:00:00').getDay()];
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000) + 1;
}
/** '10 月 1 – 7 日'；跨月时 '9 月 29 日 – 10 月 7 日' */
function holidayRange(from: string, to: string): string {
  const [, m1, d1] = from.split('-');
  const [, m2, d2] = to.split('-');
  if (m1 === m2) return d1 === d2 ? `${Number(m1)} 月 ${Number(d1)} 日` : `${Number(m1)} 月 ${Number(d1)} – ${Number(d2)} 日`;
  return `${cnDate(from)} – ${cnDate(to)}`;
}

export function Scheduling() {
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();

  const settings = useAsync(() => api.getSettings(), []);
  const [weeks, setWeeks] = useState<number | null>(null);
  useEffect(() => {
    if (weeks == null && settings.data) setWeeks(Math.min(8, Math.max(1, settings.data.scheduling.leadWeeks || 2)));
  }, [settings.data, weeks]);

  const preview = useAsync(() => (weeks == null ? Promise.resolve(null) : api.previewGenerate(weeks)), [weeks]);
  const rules = useAsync(() => api.listRules(), []);
  const adjustments = useAsync(() => api.recentAdjustments(), []);
  const classes = useAsync(() => api.listClasses(), []);

  const [ruleModal, setRuleModal] = useState<{ classId: string } | 'pick' | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const p = preview.data;
  const auto = settings.data?.scheduling.autoGenerate ?? p?.autoGenerate ?? false;
  const w = weeks ?? p?.leadWeeks ?? 2;

  const reloadAll = () => { preview.reload(); rules.reload(); adjustments.reload(); classes.reload(); bump(); };

  const toggleAuto = async (v: boolean) => {
    if (!settings.data) return;
    try {
      await api.saveSettings({ ...settings.data, scheduling: { ...settings.data.scheduling, autoGenerate: v } });
      settings.reload();
      toast(v ? '已开启每周自动生成' : '已关闭自动生成', 'ok');
    } catch (e) { toast(api.errMsg(e), 'danger'); }
  };

  const generate = async () => {
    if (!p || p.total === 0 || weeks == null) return;
    setBusy(true); setErr(null);
    try {
      if (settings.data && settings.data.scheduling.leadWeeks !== weeks) {
        await api.saveSettings({ ...settings.data, scheduling: { ...settings.data.scheduling, leadWeeks: weeks } });
        settings.reload();
      }
      const r = await api.generateSessions(weeks);
      toast(`已生成 ${r.created} 节课`, 'ok');
      reloadAll();
    } catch (e) { setErr(api.errMsg(e)); } finally { setBusy(false); }
  };

  const setActive = async (r: RuleRow, active: boolean) => {
    if (!active) {
      const ok = await confirm({ title: `停用「${r.className}」的这条规则？`, body: '停用后不再按它生成新课次，已生成的课次不受影响。', confirmText: '停用' });
      if (!ok) return;
    }
    try {
      await api.setRuleActive(r.id, active);
      toast(active ? '规则已启用' : '规则已停用', 'ok');
      reloadAll();
    } catch (e) { toast(api.errMsg(e), 'danger'); }
  };

  // 右栏按班级计数（同一班多条规则合并）
  const byClass = useMemo(() => {
    const m = new Map<string, { name: string; color: string; count: number }>();
    p?.rules.forEach((r) => {
      const cur = m.get(r.classId);
      if (cur) cur.count += r.count; else m.set(r.classId, { name: r.className, color: r.classColor, count: r.count });
    });
    return [...m.values()];
  }, [p]);

  const autoHint = auto ? `每周一早上按规则补齐，始终保持提前 ${w} 周` : '关闭后只在你点「立即生成」时才排课';
  const lastGen = p?.lastGeneratedAt != null ? cnDate(dateOf(p.lastGeneratedAt)) : '尚未生成';
  const through = p?.scheduledThrough ? cnDate(p.scheduledThrough) : '—';

  const dotStyle = (color: string): CSSProperties => ({ width: 8, height: 8, borderRadius: 3, flexShrink: 0, background: color });

  return (
    <>
      <PageHeader crumb={{ to: '/schedule', label: '课表' }} title="排课" right={<>
        <button className="btn" onClick={() => setExtraOpen(true)}>临时加课</button>
        <button className="btn primary" onClick={() => setRuleModal('pick')}>设置上课时间</button>
      </>} />

      <div className="page-body fixed" style={{ gap: 16 }}>
        {(preview.error || settings.error) && <div className="err">{preview.error ?? settings.error}</div>}
        {!p && preview.loading && <Loading />}
        {p && (
          <>
            <section className="card" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 22, padding: '16px 20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <Switch on={auto} onChange={toggleAuto} label="每周自动生成课次" />
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>每周自动生成课次</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{autoHint}</span>
                </span>
              </label>

              <div className="divider-v" />

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>提前生成</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 5 }}>
                  <Stepper value={w} min={1} max={8} onChange={(v) => setWeeks(v)} />
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>周</span>
                </div>
              </div>

              <div className="divider-v" />

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>上次生成</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, marginTop: 4, color: p.lastGeneratedAt == null ? 'var(--ink-4)' : undefined }}>{lastGen}</div>
              </div>

              <div className="divider-v" />

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>课表已排到</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{through}</div>
              </div>

              <div style={{ flexGrow: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <button className="btn lg primary" disabled={busy || p.total === 0 || preview.loading} onClick={generate}>
                  {p.total === 0 ? '无需生成' : `立即生成 ${p.total} 节`}
                </button>
                {err && <div className="err">{err}</div>}
              </div>
            </section>

            <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 18 }}>
              <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
                {/* 循环规则 */}
                <section className="card" style={{ overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 50, padding: '0 20px', borderBottom: '1px solid var(--line-faint)' }}>
                    <h2 style={{ fontSize: 16 }}>循环规则</h2>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>规则只是计划，课次按规则生成后各自独立</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 34, padding: '0 20px', background: 'var(--surface-sunk)', fontSize: 11.5, color: 'var(--ink-3)' }}>
                    <span style={{ flexGrow: 1, minWidth: 0 }}>班级</span>
                    <span style={{ width: 108, flexShrink: 0 }}>每周</span>
                    <span style={{ width: 116, flexShrink: 0 }}>时段</span>
                    <span style={{ width: 74, flexShrink: 0 }}>教室</span>
                    <span style={{ width: 68, flexShrink: 0, textAlign: 'right' }}>节 / 周</span>
                    <span style={{ width: 96, flexShrink: 0, textAlign: 'right' }}>操作</span>
                  </div>
                  {rules.data && rules.data.length === 0 && (
                    <div className="empty" style={{ padding: '28px 20px' }}>
                      <div className="t">还没有循环规则</div>
                      <div>给班级设好每周上课时间，课次就能按周自动生成</div>
                      <button className="btn sm" onClick={() => setRuleModal('pick')}>设置上课时间</button>
                    </div>
                  )}
                  {rules.data?.map((r) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, height: 48, padding: '0 20px', borderTop: '1px solid var(--line-soft)', opacity: r.active ? 1 : 0.55 }}>
                      <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5 }}>
                        <span style={dotStyle(r.active ? r.classColor : 'var(--ink-4)')} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.className}</span>
                        {!r.active && <span className="pill neutral">已停用</span>}
                      </span>
                      <span style={{ width: 108, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{r.weekdaysText}</span>
                      <span className="num" style={{ width: 116, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{r.startTime} – {r.endTime}</span>
                      <span style={{ width: 74, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{r.room ?? '—'}</span>
                      <span className="num" style={{ width: 68, flexShrink: 0, textAlign: 'right', fontSize: 14, fontWeight: 600 }}>{r.perWeek}</span>
                      <span style={{ width: 96, flexShrink: 0, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                        <a role="button" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => setRuleModal({ classId: r.classId })}>编辑</a>
                        <a role="button" style={{ fontSize: 12, cursor: 'pointer', color: r.active ? 'var(--ink-3)' : undefined }} onClick={() => setActive(r, !r.active)}>{r.active ? '停用' : '启用'}</a>
                      </span>
                    </div>
                  ))}
                </section>

                {/* 手动调整 */}
                <section className="card" style={{ overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 50, padding: '0 20px', borderBottom: '1px solid var(--line-faint)' }}>
                    <h2 style={{ fontSize: 16 }}>已生成课次的手动调整</h2>
                    <div style={{ flexGrow: 1 }} />
                    <Link to="/schedule" style={{ fontSize: 12 }}>在课表上改</Link>
                  </div>
                  {adjustments.data && adjustments.data.length === 0 && (
                    <div className="empty" style={{ padding: '24px 20px' }}><div>最近没有取消或加课</div></div>
                  )}
                  {adjustments.data?.map((a) => <AdjustmentRow key={a.id} a={a} />)}
                </section>
              </div>

              {/* 右栏 */}
              <aside style={{ width: 352, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
                <section className="card" style={{ overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--line-faint)' }}>
                    <h2 style={{ fontSize: 16 }}>本次将生成</h2>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 7 }}>
                      <span className="num" style={{ fontSize: 30, fontWeight: 600, color: 'var(--accent-deep)', lineHeight: 1 }}>{p.total}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>节课 · <span className="num">{cnDate(p.from)} – {cnDate(p.to)}</span></span>
                    </div>
                  </div>
                  {byClass.length === 0 && (
                    <div style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--ink-3)' }}>这个区间里没有需要补的课次</div>
                  )}
                  {byClass.map((c) => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 18px', borderTop: '1px solid var(--line-soft)' }}>
                      <span style={dotStyle(c.color)} />
                      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5 }}>{c.name}</span>
                      <span className="num" style={{ fontSize: 13.5, fontWeight: 600 }}>{c.count} 节</span>
                    </div>
                  ))}
                </section>

                {p.holidays.length > 0 && (
                  <section style={{ background: 'var(--banner-warn-bg)', border: '1px solid var(--banner-warn-line)', borderRadius: 14, padding: '15px 18px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <IconInfo size={15} style={{ color: 'var(--warn-ink)' }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-on-warn)' }}>生成后需要你手动处理</span>
                    </div>
                    {p.holidays.map((h) => (
                      <p key={h.name + h.from} style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--ink-on-warn)', lineHeight: 1.7 }}>
                        <span className="num">{holidayRange(h.from, h.to)}</span>是{h.name}。系统不会自动跳过节假日，这 <span className="num">{daysBetween(h.from, h.to)}</span> 天的课会照常生成（共 <span className="num">{h.affected}</span> 节），请到课表上取消 —— 取消不顺延，直接少上。
                      </p>
                    ))}
                  </section>
                )}

                <section className="card" style={{ padding: '15px 18px', flexShrink: 0 }}>
                  {p.conflicts.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <IconCheck size={15} style={{ color: 'var(--ok-ink)' }} />
                      <span style={{ fontSize: 13, color: 'var(--ok-ink)' }}>已检查教室与时段冲突，未发现冲突</span>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger-ink)' }}>发现 <span className="num">{p.conflicts.length}</span> 处教室冲突</div>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {p.conflicts.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--danger-ink)', lineHeight: 1.6 }}>
                            <span className="num">{md(c.date)}</span> {c.room}：{c.a} <span className="num">{c.timeA}</span> 与 {c.b} <span className="num">{c.timeB}</span> 重叠
                          </div>
                        ))}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>冲突不阻止生成，生成后可在课表上改时间或取消。</div>
                    </>
                  )}
                </section>

                <div style={{ flexGrow: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7, flexShrink: 0 }}>生成只创建课次，不扣任何人的课时。课时在点名确认时才扣。</p>
              </aside>
            </div>
          </>
        )}
      </div>

      {ruleModal === 'pick' && (
        <Modal title="设置哪个班的上课时间？" onClose={() => setRuleModal(null)} width={420}
          footer={<button className="btn" onClick={() => setRuleModal(null)}>取消</button>}>
          {(classes.data?.cards ?? []).length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>还没有在读班级，先去「班级」新建一个。</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(classes.data?.cards ?? []).map((c) => (
              <button key={c.id} type="button" className="btn" style={{ justifyContent: 'flex-start', gap: 10 }} onClick={() => setRuleModal({ classId: c.id })}>
                <span style={dotStyle(c.color)} />{c.name}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{c.rules.filter((r) => r.active).map((r) => `${r.weekdaysText} ${r.startTime}`).join(' · ') || '未设置'}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {ruleModal && ruleModal !== 'pick' && (() => {
        const c = classes.data?.cards.find((x) => x.id === ruleModal.classId);
        if (!c) return null;
        return (
          <ClassScheduleModal classId={c.id} className={c.name} durationMin={c.durationMin} defaultRoom={c.room ?? ''} rules={c.rules}
            onClose={() => setRuleModal(null)} onDone={() => { setRuleModal(null); reloadAll(); }} />
        );
      })()}
      {extraOpen && (
        <ExtraSessionModal classes={classes.data?.cards ?? []}
          onClose={() => setExtraOpen(false)} onDone={() => { setExtraOpen(false); reloadAll(); }} />
      )}
    </>
  );
}

function AdjustmentRow({ a }: { a: Adjustment }) {
  const cancel = a.kindLabel === 'cancel';
  const main = cancel
    ? `${a.className} ${dow(a.date)} ${a.startTime}${a.cancelReason ? ' · ' + a.cancelReason : ''}`
    : `${a.className} · ${a.startTime} – ${a.endTime}${a.room ? ' · ' + a.room : ''}`;
  const right = cancel ? '不顺延，不扣课时' : (a.note ?? '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 48, padding: '0 20px', borderTop: '1px solid var(--line-soft)' }}>
      <span className="num" style={{ width: 50, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>{md(a.date)}</span>
      <span style={{ width: 62, flexShrink: 0 }}>
        <span className={`pill ${cancel ? 'neutral' : 'ok'}`} style={{ height: 21, padding: '0 8px' }}>{cancel ? '取消' : '加课'}</span>
      </span>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{main}</span>
      {right && <span style={{ fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0 }}>{right}</span>}
    </div>
  );
}
