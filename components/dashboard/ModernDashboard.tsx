'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Home,
  AlertTriangle,
  Clock,
  Eye,
  BarChart3,
  Activity,
  Users,
  Target,
  Send,
  MessageCircle,
  UserCheck,
  Inbox as InboxIcon,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import ModernKpiCard from './ModernKpiCard';
import CompactChart from './CompactChart';

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
    properties_by_city?: Array<{name: string, value: number}>;
    price_ranges?: Array<{range: string, count: number}>;
    properties_total?: number;
    avg_price?: number;
    avg_size?: number;
    active_properties?: number;
  };
}

interface ModernDashboardProps {
  data: DashboardData;
}

export default function ModernDashboard({ data }: ModernDashboardProps) {
  const [viewMode, setViewMode] = useState<'overview' | 'detailed'>('overview');
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const k = data?.kpis || {};

  // Fetch additional analytics data
  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const response = await fetch('/api/v1/dashboard/aggregations', {
          cache: 'no-store' // Force fresh data
        });
        if (response.ok) {
          const analyticsData = await response.json();
          console.log('Dashboard analytics received:', analyticsData);
          setAnalytics(analyticsData);
        } else {
          console.error('Failed to fetch analytics:', response.status);
        }
      } catch (error) {
        console.error('Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  // Real data from API or fallback to defaults
  const propertiesByCity = analytics?.properties_by_city || [
    { name: 'אין נתונים', value: 0, color: '#F2811D' }
  ];

  const priceRanges = analytics?.price_ranges || [
    { range: 'אין נתונים', count: 0, color: '#F2811D' }
  ];

  const weeklyActivity = analytics?.weekly_activity || [
    { day: 'א', properties: 0 },
    { day: 'ב', properties: 0 },
    { day: 'ג', properties: 0 },
    { day: 'ד', properties: 0 },
    { day: 'ה', properties: 0 },
    { day: 'ו', properties: 0 },
    { day: 'ש', properties: 0 }
  ];

  return (
    <main className="pb-20 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">דשבורד</h1>
          <p className="text-gray-600 mt-1">סקירה כללית של המערכת שלך</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewMode('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'overview'
                ? 'bg-brand-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Eye className="h-4 w-4 inline-block ml-2" />
            סקירה
          </button>
          <button
            onClick={() => setViewMode('detailed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'detailed'
                ? 'bg-brand-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <BarChart3 className="h-4 w-4 inline-block ml-2" />
            מפורט
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))
        ) : (
          <>
            <ModernKpiCard
              title="נכסים מאושרים"
              value={k.approved_properties?.toString() || '0'}
              change={`${k.active_approved_properties || 0} פעילים`}
              trend={(k.approved_properties || 0) > 0 ? "up" : "neutral"}
              icon={Home}
              color="blue"
              href="/approved-properties"
            />
            <ModernKpiCard
              title="שגיאות יבוא"
              value={k.import_errors_7d?.toString() || '0'}
              change="7 ימים אחרונים"
              trend={(k.import_errors_7d || 0) > 0 ? "down" : "neutral"}
              icon={AlertTriangle}
              color="orange"
            />
          </>
        )}
      </div>

      {/* Renters + Matching */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SmallStat icon={<Users className="h-4 w-4" />} label="מאגר שוכרים" value={k.renters_pool ?? 0} hint={`+${k.renters_new_7d ?? 0} ב-7 ימים`} href="/renters" tone="purple" />
        <SmallStat icon={<Target className="h-4 w-4" />} label="התאמות פעילות" value={k.matches_active ?? 0} hint={`ציון ממוצע: ${k.matches_avg_score ?? '—'}`} tone="emerald" />
        <SmallStat icon={<Send className="h-4 w-4" />} label="פניות שיצאו היום" value={k.outreach_sent_today ?? 0} hint={`סה"כ ${k.outreach_sent_total ?? 0}`} tone="blue" />
        <SmallStat icon={<MessageCircle className="h-4 w-4" />} label="הודעות נכנסות (24ש׳)" value={k.inbound_24h ?? 0} hint={`${k.active_threads ?? 0} שיחות פעילות`} href="/inbox" tone="amber" />
      </section>

      {/* Operational status */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SmallStat icon={<UserCheck className="h-4 w-4" />} label="ממתינות לאדם" value={k.handoff_pending ?? 0} hint="בקשות handoff פתוחות" href="/inbox?filter=human_takeover" tone="red" />
        <SmallStat icon={<CheckCircle2 className="h-4 w-4" />} label="הסירו אותם" value={k.opted_out ?? 0} hint="הצטרפו לרשימת חסומים" tone="gray" />
        <SmallStat icon={<InboxIcon className="h-4 w-4" />} label="שיחות פעילות" value={k.active_threads ?? 0} hint="בוואטסאפ" href="/inbox" tone="indigo" />
      </section>

      {/* Recent activity history */}
      {data?.history && data.history.length > 0 && (
        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg flex items-center gap-2"><Activity className="h-5 w-5 text-brand-primary" /> פעילות אחרונה</h2>
            <span className="text-xs text-gray-500">{data.history.length} אירועים אחרונים</span>
          </div>
          <ul className="space-y-2">
            {data.history.map((h, i) => (
              <HistoryRow key={i} item={h} />
            ))}
          </ul>
        </section>
      )}

      {/* Charts Grid */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Properties by City */}
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-40 bg-gray-200 rounded"></div>
            </div>
          ) : (
            <CompactChart
              title="נכסים לפי עיר"
              type="pie"
              data={propertiesByCity}
              height={200}
            />
          )}
          
          {/* Price Ranges */}
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-40 bg-gray-200 rounded"></div>
            </div>
          ) : (
            <CompactChart
              title="טווחי מחירים"
              type="bar"
              data={priceRanges.map((item: any) => ({ name: item.range, value: item.count }))}
              height={200}
            />
          )}
          
          {/* Weekly Activity */}
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
              <div className="h-40 bg-gray-200 rounded"></div>
            </div>
          ) : (
            <CompactChart
              title="פעילות שבועית"
              type="line"
              data={weeklyActivity}
              height={200}
            />
          )}
        </div>
      )}

      {/* Detailed Analytics */}
      {viewMode === 'detailed' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Larger detailed charts would go here */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">ניתוח נכסים מפורט</h3>
            <CompactChart
              title="התפלגות נכסים"
              type="bar"
              data={propertiesByCity}
              height={300}
            />
          </div>
          
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">מגמות שבועיות</h3>
            <CompactChart
              title="פעילות"
              type="line"
              data={weeklyActivity}
              height={300}
            />
          </div>
        </div>
      )}

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gradient-to-r from-brand-bg to-orange-50 rounded-lg p-4 border border-brand-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-primary text-white rounded-lg">
              <Home className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-brand-inkMuted">שטח ממוצע</p>
              <p className="text-lg font-bold text-brand-accent">
                {loading ? (
                  <span className="animate-pulse bg-gray-200 rounded h-6 w-16 inline-block"></span>
                ) : (
                  `${analytics?.avg_size || 0} מ״ר`
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-primaryMuted text-white rounded-lg">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-brand-primaryMuted">מחיר ממוצע</p>
              <p className="text-lg font-bold text-brand-accent">
                {loading ? (
                  <span className="animate-pulse bg-gray-200 rounded h-6 w-20 inline-block"></span>
                ) : (
                  `₪${analytics?.avg_price?.toLocaleString() || 0}`
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-green-50 to-brand-bg rounded-lg p-4 border border-brand-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-success text-white rounded-lg">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-brand-inkMuted">תפוסה</p>
              <p className="text-lg font-bold text-brand-accent">100%</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-brand-bg to-yellow-50 rounded-lg p-4 border border-brand-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-warning text-white rounded-lg">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-brand-inkMuted">פעילים</p>
              <p className="text-lg font-bold text-brand-accent">{analytics?.active_properties ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

const TONE_CLASSES: Record<string, { wrap: string; icon: string }> = {
  purple: { wrap: 'border-purple-200 bg-purple-50/40', icon: 'text-purple-700' },
  emerald: { wrap: 'border-emerald-200 bg-emerald-50/40', icon: 'text-emerald-700' },
  blue: { wrap: 'border-blue-200 bg-blue-50/40', icon: 'text-blue-700' },
  amber: { wrap: 'border-amber-200 bg-amber-50/40', icon: 'text-amber-700' },
  red: { wrap: 'border-red-200 bg-red-50/40', icon: 'text-red-700' },
  gray: { wrap: 'border-gray-200 bg-gray-50/60', icon: 'text-gray-600' },
  indigo: { wrap: 'border-indigo-200 bg-indigo-50/40', icon: 'text-indigo-700' },
}

function SmallStat({ icon, label, value, hint, href, tone = 'gray' }: {
  icon: React.ReactNode
  label: string
  value: number | string
  hint?: string
  href?: string
  tone?: keyof typeof TONE_CLASSES
}) {
  const t = TONE_CLASSES[tone] || TONE_CLASSES.gray
  const inner = (
    <div className={`rounded-lg border p-3 ${t?.wrap} ${href ? 'hover:shadow-sm transition-shadow' : ''}`}>
      <div className={`flex items-center gap-1.5 mb-1 text-xs font-medium ${t?.icon}`}>
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString('he-IL') : value}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}

const KIND_META: Record<string, { dot: string; label: string }> = {
  approval: { dot: 'bg-emerald-500', label: 'אישור' },
  outreach: { dot: 'bg-blue-500', label: 'פנייה' },
  renter: { dot: 'bg-purple-500', label: 'שוכר' },
  alert: { dot: 'bg-red-500', label: 'התראה' },
}

function HistoryRow({ item }: { item: { ts: string; kind: string; label: string; ref?: string } }) {
  const meta = KIND_META[item.kind] || { dot: 'bg-gray-400', label: item.kind }
  const ts = item.ts ? new Date(item.ts) : null
  const timeStr = ts ? ts.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const body = (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${meta.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-gray-800 truncate">{item.label}</div>
        <div className="text-xs text-gray-500">{meta.label} · {timeStr}</div>
      </div>
      {item.ref && <ExternalLink className="h-3 w-3 text-gray-400 shrink-0 mt-1.5" />}
    </div>
  )
  return item.ref ? (
    <li><Link href={item.ref} className="block hover:bg-gray-50 rounded px-2 py-1 -mx-2">{body}</Link></li>
  ) : (
    <li className="px-2 py-1 -mx-2">{body}</li>
  )
}