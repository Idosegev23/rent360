'use client';

import { useState } from 'react';
import { 
  TrendingUp, 
  Users, 
  Home, 
  MessageSquare, 
  AlertTriangle, 
  Clock,
  Filter,
  Eye,
  BarChart3,
  PieChart,
  Activity
} from 'lucide-react';
import ModernKpiCard from './ModernKpiCard';
import CompactChart from './CompactChart';
import NeedsAttention from './NeedsAttention';

interface DashboardData {
  kpis?: {
    leads_last_7d?: number;
    matches_waiting?: number;
    import_errors_7d?: number;
    median_response_minutes?: string | number;
  };
  needs_attention?: {
    failed_messages?: any[];
  };
}

interface ModernDashboardProps {
  data: DashboardData;
}

export default function ModernDashboard({ data }: ModernDashboardProps) {
  const [viewMode, setViewMode] = useState<'overview' | 'detailed'>('overview');
  const k = data?.kpis || {};

  // Mock data for charts - in real app this would come from API
  const propertiesByCity = [
    { name: 'קרית ביאליק', value: 3, color: '#F2811D' },
    { name: 'תל אביב', value: 0, color: '#F27127' },
    { name: 'רמת גן', value: 0, color: '#732002' }
  ];

  const priceRanges = [
    { range: '2000-4000', count: 2, color: '#F2811D' },
    { range: '4000-6000', count: 1, color: '#F27127' },
    { range: '6000+', count: 1, color: '#732002' }
  ];

  const weeklyActivity = [
    { day: 'א', properties: 1, leads: 0, messages: 0 },
    { day: 'ב', properties: 0, leads: 0, messages: 0 },
    { day: 'ג', properties: 1, leads: 0, messages: 0 },
    { day: 'ד', properties: 0, leads: 0, messages: 0 },
    { day: 'ה', properties: 1, leads: 0, messages: 0 },
    { day: 'ו', properties: 0, leads: 0, messages: 0 },
    { day: 'ש', properties: 0, leads: 0, messages: 0 }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <ModernKpiCard
          title="נכסים פעילים"
          value="3"
          change="+3 השבוע"
          trend="up"
          icon={Home}
          color="blue"
          href="/properties"
        />
        <ModernKpiCard
          title="לידים חדשים"
          value={k.leads_last_7d?.toString() || '0'}
          change="7 ימים אחרונים"
          trend="neutral"
          icon={Users}
          color="green"
          href="/leads"
        />
        <ModernKpiCard
          title="התאמות ממתינות"
          value={k.matches_waiting?.toString() || '0'}
          change="צריך טיפול"
          trend="neutral"
          icon={TrendingUp}
          color="purple"
          href="/matches"
        />
        <ModernKpiCard
          title="הודעות היום"
          value="0"
          change="תגובה ממוצעת"
          trend="neutral"
          icon={MessageSquare}
          color="orange"
          href="/inbox"
        />
      </div>

      {/* Charts Grid */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Properties by City */}
          <CompactChart
            title="נכסים לפי עיר"
            type="pie"
            data={propertiesByCity}
            height={200}
          />
          
          {/* Price Ranges */}
          <CompactChart
            title="טווחי מחירים"
            type="bar"
            data={priceRanges.map(item => ({ name: item.range, value: item.count }))}
            height={200}
          />
          
          {/* Weekly Activity */}
          <CompactChart
            title="פעילות שבועית"
            type="line"
            data={weeklyActivity}
            height={200}
          />
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
              <p className="text-lg font-bold text-brand-accent">132 מ״ר</p>
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
              <p className="text-lg font-bold text-brand-accent">₪4,900</p>
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
              <p className="text-xs text-brand-inkMuted">תגובה</p>
              <p className="text-lg font-bold text-brand-accent">{k.median_response_minutes || '—'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Needs Attention */}
      <NeedsAttention items={data?.needs_attention?.failed_messages || []} />
    </main>
  );
}