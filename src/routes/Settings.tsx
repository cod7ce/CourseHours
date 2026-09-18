import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router';
import * as api from '../lib/api';
import type { AllSettings } from '../lib/api';
import { Loading, PageHeader, useConfirm, useRefresh, useToast } from '../components/ui';
import {
  AlertsPreview, AlertsSection, DataPreview, DataSection, OrgPreview, OrgSection, VersionPreview, VersionSection,
  PacksPreview, PacksSection, RulesPreview, RulesSection,
} from './SettingsSections';

export type Section = 'rules' | 'alerts' | 'packs' | 'org' | 'data' | 'version';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'rules', label: '课时规则' },
  { key: 'alerts', label: '提醒与预警' },
  { key: 'packs', label: '班级与课包' },
  { key: 'org', label: '机构信息' },
  { key: 'data', label: '数据与备份' },
  { key: 'version', label: '版本' },
];
const isSection = (s: string | undefined): s is Section => SECTIONS.some((x) => x.key === s);

/** 默认值 = 晓夏老师英语班当前在用的配置（2026-09-18 固定）。恢复默认回到这一份；lastGeneratedAt 不属于设置，保留。 */
export const DEFAULTS: Omit<AllSettings, 'scheduling'> & { scheduling: Omit<AllSettings['scheduling'], 'lastGeneratedAt'> } = {
  hoursRule: { present: 1, late: 1, leave: 0, absent: 0, allowNegative: true, autoOffsetOnRecharge: true, owedPriceMode: 'package', undoWindowDays: 7 },
  alerts: { lowBalanceThreshold: 3, owedAlertThreshold: 3, dailyDigest: true, dailyDigestAt: '10:00', scheduleLeadDays: 7, channels: ['desktop', 'badge'] },
  defaults: {
    classCapacity: 10, durationMin: 90, defaultRoom: '长桌大厅', rooms: ['长桌大厅'],
    paymentMethods: ['wechat', 'alipay', 'cash', 'transfer'],
    packagePresets: [{ sessions: 24, amountCents: 360000 }, { sessions: 12, amountCents: 192000 }, { sessions: 10, amountCents: 170000 }],
  },
  org: { name: '晓夏老师英语班', owner: '', phone: '', address: '', logoPath: null, receiptTitle: '', receiptFooter: '' },
  backup: { auto: true, at: '22:00', keep: 30 },
  scheduling: { autoGenerate: true, leadWeeks: 1 },
};

/** 各分区共用的草稿修改器：patch('alerts', { dailyDigest: false }) */
export type Patch = <K extends keyof AllSettings>(key: K, partial: Partial<AllSettings[K]>) => void;

export function Settings() {
  const params = useParams<{ section?: string }>();
  const section: Section = isSection(params.section) ? params.section : 'rules';
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();

  const [saved, setSaved] = useState<AllSettings | null>(null);
  const [draft, setDraft] = useState<AllSettings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [loadTick, setLoadTick] = useState(0);
  /** 重新从后端拉设置并丢弃草稿（初次加载、恢复备份/清空数据之后） */
  const reload = useCallback(() => setLoadTick((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    api.getSettings()
      .then((s) => { if (alive) { setSaved(s); setDraft(s); setLoadErr(null); } })
      .catch((e) => { if (alive) setLoadErr(api.errMsg(e)); });
    return () => { alive = false; };
  }, [loadTick]);

  const dirty = useMemo(() => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const patch = useCallback<Patch>((key, partial) => {
    setDraft((d) => (d ? { ...d, [key]: { ...d[key], ...partial } } : d));
  }, []);

  // 离开设置页且有未保存改动时提示（分区之间切换不拦）
  const blocker = useBlocker(({ nextLocation }) => dirty && !nextLocation.pathname.startsWith('/settings'));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirm({ title: '有未保存的改动', body: '离开后这些改动会丢失。要放弃改动离开吗？', danger: true, confirmText: '放弃并离开' })
      .then((ok) => { if (ok) blocker.proceed(); else blocker.reset(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  const save = async () => {
    if (!draft) return;
    setSaving(true); setSaveErr(null);
    try {
      const r = await api.saveSettings(draft);
      setSaved(r); setDraft(r);
      toast('已保存', 'ok');
      bump();
    } catch (e) {
      setSaveErr(api.errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft((d) => d ? {
      ...d,
      hoursRule: { ...DEFAULTS.hoursRule },
      alerts: { ...DEFAULTS.alerts, channels: [...DEFAULTS.alerts.channels] },
      defaults: { ...DEFAULTS.defaults, rooms: [...DEFAULTS.defaults.rooms], paymentMethods: [...DEFAULTS.defaults.paymentMethods], packagePresets: DEFAULTS.defaults.packagePresets.map((p) => ({ ...p })) },
      org: { ...DEFAULTS.org },
      backup: { ...DEFAULTS.backup },
      scheduling: { ...d.scheduling, ...DEFAULTS.scheduling },
    } : d);
    setSaveErr(null);
  };

  const header = (
    <PageHeader title="设置" sub="改动只影响之后的点名和充值，已产生的流水不会重算"
      right={draft && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 13px', borderRadius: 14, fontSize: 12,
          background: dirty ? 'var(--warn-soft)' : 'var(--ok-soft)', color: dirty ? 'var(--warn-ink)' : 'var(--ok-ink)',
        }}>{dirty ? '有未保存的改动' : '已是最新'}</span>
      )} />
  );

  if (loadErr) return <>{header}<div className="page-body"><div className="err">{loadErr}</div></div></>;
  if (!draft) return <>{header}<div className="page-body"><Loading /></div></>;

  return (
    <>
      {header}
      <div className="page-body fixed" style={{ flexDirection: 'row', gap: 20 }}>
        <nav style={{ width: 176, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map((s) => {
            const active = s.key === section;
            return (
              <button key={s.key} type="button" onClick={() => nav(`/settings/${s.key}`)} style={{
                display: 'flex', alignItems: 'center', height: 38, padding: '0 14px', border: 0, borderRadius: 9, fontSize: 13.5, textAlign: 'left', cursor: 'pointer',
                background: active ? 'var(--nav-active-2)' : 'transparent', color: active ? 'var(--ink)' : 'var(--ink-2)', fontWeight: active ? 600 : 400,
              }}>{s.label}</button>
            );
          })}
        </nav>

        <section className="card" style={{ flexGrow: 1, minWidth: 0, minHeight: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', paddingBottom: 14 }}>
            {section === 'rules' && <RulesSection d={draft} patch={patch} />}
            {section === 'alerts' && <AlertsSection d={draft} patch={patch} />}
            {section === 'packs' && <PacksSection d={draft} patch={patch} />}
            {section === 'org' && <OrgSection d={draft} patch={patch} />}
            {section === 'data' && <DataSection d={draft} patch={patch} reload={reload} />}
            {section === 'version' && <VersionSection />}
          </div>

          {section !== 'version' && <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--line-faint)', flexShrink: 0 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>保存后立即生效，历史流水不受影响</span>
            {saveErr && <span className="err">{saveErr}</span>}
            <div style={{ flexGrow: 1 }} />
            <button type="button" className="btn ghost" style={{ height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13.5 }} onClick={reset}>恢复默认</button>
            {dirty && <button type="button" className="btn" style={{ height: 38, padding: '0 18px', borderRadius: 10, fontSize: 13.5 }} onClick={() => setDraft(saved)}>放弃改动</button>}
            <button type="button" className="btn primary" style={{ height: 38, padding: '0 24px', borderRadius: 10 }} disabled={saving || !dirty} onClick={save}>保存设置</button>
          </div>}
        </section>

        <aside style={{ width: 304, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', minHeight: 0 }}>
          {section === 'rules' && <RulesPreview d={draft} />}
          {section === 'alerts' && <AlertsPreview d={draft} />}
          {section === 'packs' && <PacksPreview d={draft} />}
          {section === 'org' && <OrgPreview d={draft} />}
          {section === 'data' && <DataPreview d={draft} />}
          {section === 'version' && <VersionPreview />}
        </aside>
      </div>
    </>
  );
}
