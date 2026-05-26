'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Home,
  AlertTriangle,
  Activity,
  Users,
  Target,
  Send,
  MessageCircle,
  UserCheck,
  Inbox as InboxIcon,
  CheckCircle2,
  ExternalLink,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import Topbar from '../shell/Topbar';

interface DashboardData {
  kpis?: {
    import_errors_7d?: number;
    approved_properties?: number;
    active_approved_properties?: number;
    renters_pool?: number;
    renters_new_7d?: number;
    matches_total?: number;
    matches_active?: number;
    matches_avg_score?: number | null;
    outreach_sent_total?: number;
    outreach_sent_today?: number;
    inbound_24h?: number;
    active_threads?: number;
    handoff_pending?: number;
    opted_out?: number;
    user_role?: string;
    user_name?: string;
  };
  history?: Array<{ ts: string; kind: string; label: string; ref?: string }>;
  analytics?: {
    properties_by_city?: Array<{ name: string; value: number }>;
    price_ranges?: Array<{ range: string; count: number }>;
    properties_total?: number;
    avg_price?: number;
    avg_size?: number;
    active_properties?: number;
  };
}

export default function ModernDashboard({ data }: { data: DashboardData }) {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const k = data?.kpis || {};

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/v1/dashboard/aggregations', { cache: 'no-store' });
        if (response.ok) setAnalytics(await response.json());
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, []);

  const propertiesByCity = analytics?.properties_by_city || [];

  return (
    <>
      <Topbar
        crumb="בית"
        title="דשבורד"
        action={
          <Link href="/properties/new" className="btn btn-brand">
            <Plus size={14} /> נכס חדש
          </Link>
        }
      />

      <div className="page-wrap">
        {/* KPI Hero Row */}
        <section className="grid gap-4 mb-7" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)' }}>
          <Link href="/approved-properties" className="kpi kpi-hero block no-underline">
            <div className="label">נכסים מאושרים</div>
            <div className="value">{loading ? '—' : (k.approved_properties ?? 0).toLocaleString('he-IL')}</div>
            <div className="delta positive"><strong>{k.active_approved_properties ?? 0}</strong> פעילים כרגע</div>
          </Link>

          <KpiCard
            label="מאגר שוכרים"
            value={k.renters_pool ?? 0}
            delta={`+${k.renters_new_7d ?? 0} ב-7 ימים`}
            href="/renters"
            positive
          />
          <KpiCard
            label="פניות היום"
            value={k.outreach_sent_today ?? 0}
            delta={`סה״כ ${(k.outreach_sent_total ?? 0).toLocaleString('he-IL')}`}
          />
        </section>

        {/* Ops row */}
        <section className="section-h">
          <div>
            <h2>סטטוס תפעולי</h2>
            <div className="subtitle">מצב חי של פניות, שיחות והתאמות</div>
          </div>
        </section>
        <section className="grid gap-3 mb-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <SmallStat icon={<Target size={14} />} label="התאמות פעילות" value={k.matches_active ?? 0} hint={`ציון ממוצע: ${k.matches_avg_score ?? '—'}`} tone="brand" />
          <SmallStat icon={<MessageCircle size={14} />} label="הודעות (24ש׳)" value={k.inbound_24h ?? 0} hint={`${k.active_threads ?? 0} שיחות פעילות`} href="/inbox" tone="blue" />
          <SmallStat icon={<UserCheck size={14} />} label="ממתינות לאדם" value={k.handoff_pending ?? 0} hint="handoff פתוחים" href="/inbox?filter=human_takeover" tone="red" />
          <SmallStat icon={<CheckCircle2 size={14} />} label="הסירו אותם" value={k.opted_out ?? 0} hint="ברשימה החסומה" tone="amber" />
          <SmallStat icon={<AlertTriangle size={14} />} label="שגיאות יבוא" value={k.import_errors_7d ?? 0} hint="7 ימים אחרונים" tone="red" />
        </section>

        {/* Activity history */}
        {data?.history && data.history.length > 0 && (
          <section className="surface-card mb-7">
            <div className="section-h" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ fontSize: 17 }}>פעילות אחרונה</h2>
              </div>
              <span className="eyebrow">{data.history.length} אירועים</span>
            </div>
            <ul className="space-y-1">
              {data.history.map((h, i) => (
                <HistoryRow key={i} item={h} />
              ))}
            </ul>
          </section>
        )}

        {/* Aggregations */}
        <section className="section-h">
          <div>
            <h2>פילוח</h2>
            <div className="subtitle">נכסים לפי עיר וטווחי מחיר</div>
          </div>
        </section>
        <section className="grid gap-4 mb-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <BreakdownCard title="נכסים לפי עיר" items={(propertiesByCity || []).map((p: any) => ({ label: p.name, value: p.value }))} loading={loading} />
          <BreakdownCard
            title="טווחי מחיר"
            items={(analytics?.price_ranges || []).map((r: any) => ({ label: r.range, value: r.count }))}
            loading={loading}
          />
          <StatTrio
            avgSize={analytics?.avg_size}
            avgPrice={analytics?.avg_price}
            activeProperties={analytics?.active_properties}
            loading={loading}
          />
        </section>
      </div>
    </>
  );
}

function KpiCard({ label, value, delta, href, positive }: { label: string; value: number | string; delta?: string; href?: string; positive?: boolean }) {
  const inner = (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{typeof value === 'number' ? value.toLocaleString('he-IL') : value}</div>
      {delta && <div className={`delta ${positive ? 'positive' : ''}`}><strong>{delta}</strong></div>}
    </div>
  );
  return href ? <Link href={href} className="block no-underline">{inner}</Link> : inner;
}

const TONE_FILL: Record<string, string> = {
  brand: 'var(--brand)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  purple: 'var(--purple)',
  ink: 'var(--ink)',
};

function SmallStat({ icon, label, value, hint, href, tone = 'ink' }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: keyof typeof TONE_FILL;
}) {
  const accent = TONE_FILL[tone] || 'var(--ink)';
  const inner = (
    <div
      className="surface-card surface-card-interactive"
      style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: accent, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em' }}>
        {icon}
        <span style={{ textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString('he-IL') : value}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block no-underline">{inner}</Link> : inner;
}

function BreakdownCard({ title, items, loading }: { title: string; items: Array<{ label: string; value: number }>; loading: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="surface-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', margin: 0 }}>{title}</h3>
        <span className="eyebrow">{items.length}</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 18, background: 'var(--paper-2)', borderRadius: 6 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 12.5 }}>אין נתונים</div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 6).map((item, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <span style={{ width: 90, color: 'var(--ink-2)' }}>{item.label}</span>
              <span style={{ flex: 1, height: 6, background: 'var(--paper-2)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                <span style={{ position: 'absolute', insetInlineEnd: 0, top: 0, bottom: 0, width: `${(item.value / max) * 100}%`, background: 'linear-gradient(to left, var(--brand), var(--brand-glow))', borderRadius: 999 }} />
              </span>
              <span style={{ width: 36, textAlign: 'start', fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatTrio({ avgSize, avgPrice, activeProperties, loading }: { avgSize?: number; avgPrice?: number; activeProperties?: number; loading: boolean }) {
  return (
    <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', margin: 0 }}>מבט-על</h3>
      <Trio icon={<Home size={14} />} label="שטח ממוצע" value={loading ? '—' : `${avgSize ?? 0} מ״ר`} />
      <Trio icon={<TrendingUp size={14} />} label="מחיר ממוצע" value={loading ? '—' : `₪${(avgPrice ?? 0).toLocaleString('he-IL')}`} />
      <Trio icon={<Activity size={14} />} label="נכסים פעילים" value={loading ? '—' : (activeProperties ?? 0)} />
    </div>
  );
}

function Trio({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-tint)', color: 'var(--brand-deep)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      </div>
    </div>
  );
}

const KIND_META: Record<string, { tone: string; label: string }> = {
  approval: { tone: 'green',  label: 'אישור' },
  outreach: { tone: 'blue',   label: 'פנייה' },
  renter:   { tone: 'purple', label: 'שוכר' },
  alert:    { tone: 'red',    label: 'התראה' },
};

function HistoryRow({ item }: { item: { ts: string; kind: string; label: string; ref?: string } }) {
  const meta = KIND_META[item.kind] || { tone: 'outline', label: item.kind };
  const ts = item.ts ? new Date(item.ts) : null;
  const timeStr = ts ? ts.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const body = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
      <span className={`pill pill-${meta.tone}`} style={{ minWidth: 56, justifyContent: 'center' }}>{meta.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
      {item.ref && <ExternalLink size={12} style={{ color: 'var(--ink-4)' }} />}
    </div>
  );
  return item.ref ? (
    <li><Link href={item.ref} className="block hover:bg-[var(--paper-2)] rounded-md no-underline">{body}</Link></li>
  ) : (
    <li>{body}</li>
  );
}
