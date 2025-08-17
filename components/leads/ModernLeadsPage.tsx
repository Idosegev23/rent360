'use client';

import { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Users, 
  Phone, 
  Mail, 
  MapPin, 
  DollarSign,
  Calendar,
  Star,
  Clock,
  Eye
} from 'lucide-react';
import Link from 'next/link';
import ModernLeadCard from './ModernLeadCard';

interface Lead {
  id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  budget_min?: number;
  budget_max?: number;
  preferred_cities?: string[] | string;
  preferred_rooms?: number;
  status?: string;
  created_at: string;
  updated_at: string;
}

interface ModernLeadsPageProps {
  leads: Lead[];
}

export default function ModernLeadsPage({ leads }: ModernLeadsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [budgetFilter, setBudgetFilter] = useState<string>('all');

  // Filter leads based on search and filters
  const filteredLeads = leads.filter(lead => {
    const name = lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
    const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         lead.phone?.includes(searchTerm) ||
                         lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    
    const matchesBudget = budgetFilter === 'all' || (() => {
      const budget = lead.budget_max || 0;
      switch (budgetFilter) {
        case 'low': return budget <= 5000;
        case 'medium': return budget > 5000 && budget <= 10000;
        case 'high': return budget > 10000;
        default: return true;
      }
    })();

    return matchesSearch && matchesStatus && matchesBudget;
  });

  // Stats calculations
  const totalLeads = leads.length;
  const newLeads = leads.filter(lead => {
    const createdDate = new Date(lead.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return createdDate > weekAgo;
  }).length;

  const avgBudget = leads.length > 0 
    ? Math.round(leads.reduce((sum, lead) => sum + (lead.budget_max || 0), 0) / leads.length)
    : 0;

  const hotLeads = leads.filter(lead => (lead.budget_max || 0) > 8000).length;

  return (
    <main className="pb-20 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">לידים</h1>
          <p className="text-gray-600 mt-1">ניהול לקוחות פוטנציאליים</p>
        </div>
        <Link 
          href="/leads/new"
          className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-primaryMuted transition-colors"
        >
          <Plus className="h-5 w-5" />
          ליד חדש
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-brand-bg to-orange-50 rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary text-white rounded-lg">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">סך הכל לידים</p>
              <p className="text-2xl font-bold text-brand-accent">{totalLeads}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-brand-bg rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-success text-white rounded-lg">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">חדשים השבוע</p>
              <p className="text-2xl font-bold text-brand-accent">{newLeads}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-brand-bg to-yellow-50 rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-warning text-white rounded-lg">
              <DollarSign className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">תקציב ממוצע</p>
              <p className="text-2xl font-bold text-brand-accent">₪{avgBudget.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primaryMuted text-white rounded-lg">
              <Star className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-primaryMuted">לידים חמים</p>
              <p className="text-2xl font-bold text-brand-accent">{hotLeads}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, טלפון או אימייל..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
          >
            <option value="all">כל הסטטוסים</option>
            <option value="new">חדש</option>
            <option value="contacted">יצרנו קשר</option>
            <option value="qualified">מוכשר</option>
            <option value="converted">הומר</option>
          </select>

          {/* Budget Filter */}
          <select
            value={budgetFilter}
            onChange={(e) => setBudgetFilter(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
          >
            <option value="all">כל התקציבים</option>
            <option value="low">עד ₪5,000</option>
            <option value="medium">₪5,000-₪10,000</option>
            <option value="high">מעל ₪10,000</option>
          </select>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>מציג {filteredLeads.length} מתוך {totalLeads} לידים</span>
          {(searchTerm || statusFilter !== 'all' || budgetFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setBudgetFilter('all');
              }}
              className="text-brand-primary hover:text-brand-primaryMuted"
            >
              נקה פילטרים
            </button>
          )}
        </div>
      </div>

      {/* Leads Grid */}
      {filteredLeads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {totalLeads === 0 ? 'אין לידים במערכת' : 'לא נמצאו לידים'}
          </h3>
          <p className="text-gray-600 mb-6">
            {totalLeads === 0 
              ? 'התחל על ידי הוספת הליד הראשון שלך'
              : 'נסה לשנות את הפילטרים או החיפוש'
            }
          </p>
          {totalLeads === 0 && (
            <Link 
              href="/leads/new"
              className="inline-flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-primaryMuted transition-colors"
            >
              <Plus className="h-5 w-5" />
              צור ליד ראשון
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredLeads.map((lead) => (
            <ModernLeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </main>
  );
}