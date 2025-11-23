'use client';

import { useState, useEffect, useCallback } from 'react';
// Using simple Tailwind components instead of shadcn/ui
import { 
  MessageSquare, 
  User, 
  MapPin, 
  DollarSign, 
  Home, 
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Eye
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface WhatsAppLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  krayot_area: string | null;
  budget: number | null;
  rooms: number | null;
  move_in_date: string | null;
  pets: boolean | null;
  furnished: boolean | null;
  mamad: boolean | null;
  balcony: boolean | null;
  has_checks: boolean | null;
  has_guarantors: boolean | null;
  features: string[] | null;
  extra_requests: string[] | null;
  conversation_summary: string;
  processing_status: 'pending' | 'processed' | 'error';
  processed_at: string | null;
  lead_id: string | null;
  created_at: string;
}

export default function WhatsAppLeadsPage() {
  const [leads, setLeads] = useState<WhatsAppLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<WhatsAppLead | null>(null);
  const [processingMatches, setProcessingMatches] = useState<string | null>(null);

  const supabase = createClient();

  const fetchLeads = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching WhatsApp leads:', error);
      console.error('שגיאה בטעינת הלידים מוואטסאפ');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const processLead = async (leadId: string) => {
    try {
      const response = await fetch(`/api/v1/whatsapp/leads/${leadId}/matches`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to process lead');
      }

      const result = await response.json();
      console.log(`נמצאו ${result.matches_count} התאמות פוטנציאליות`);
      
      // Refresh leads
      fetchLeads();
    } catch (error) {
      console.error('Error processing lead:', error);
      console.error('שגיאה בעיבוד הליד');
    }
  };

  const findMatches = async (leadId: string) => {
    setProcessingMatches(leadId);
    try {
      await processLead(leadId);
    } finally {
      setProcessingMatches(null);
    }
  };

  const viewMatches = async (leadId: string) => {
    try {
      const response = await fetch(`/api/v1/whatsapp/leads/${leadId}/matches`);
      
      if (!response.ok) {
        throw new Error('Failed to get matches');
      }

      const result = await response.json();
      console.log('Matches for lead:', result);
      
      // Here you could open a modal or navigate to a matches page
      console.log(`נמצאו ${result.matches.length} התאמות`);
    } catch (error) {
      console.error('Error getting matches:', error);
      console.error('שגיאה בטעינת ההתאמות');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800"><CheckCircle className="w-3 h-3" />מעובד</span>;
      case 'error':
        return <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-800"><XCircle className="w-3 h-3" />שגיאה</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800"><Clock className="w-3 h-3" />ממתין</span>;
    }
  };

  const formatFeatures = (features: string[] | null) => {
    if (!features || features.length === 0) return 'אין';
    return features.join(', ');
  };

  const formatName = (firstName: string | null, lastName: string | null) => {
    return [firstName, lastName].filter(Boolean).join(' ') || 'לא צוין';
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>טוען לידים מוואטסאפ...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6" dir="rtl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">לידים מוואטסאפ</h1>
        <p className="text-muted-foreground">
          ניהול וטיפול בלידים שהתקבלו מבוט הוואטסאפ
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {leads.map((lead) => (
          <div key={lead.id} className="rounded-lg border border-brand-border bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="pb-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <User className="w-5 h-5" />
                  {formatName(lead.first_name, lead.last_name)}
                </h3>
                {getStatusBadge(lead.processing_status)}
              </div>
              <p className="text-sm text-brand-inkMuted mt-1">
                התקבל ב-{new Date(lead.created_at).toLocaleDateString('he-IL')}
              </p>
            </div>

            <div className="space-y-4">
              {/* Requirements Summary */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  <span>{lead.krayot_area || 'לא צוין'}</span>
                </div>
                
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <span>
                    {lead.budget ? `עד ₪${lead.budget.toLocaleString()}` : 'לא צוין'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-sm">
                  <Home className="w-4 h-4 text-muted-foreground" />
                  <span>{lead.rooms ? `${lead.rooms} חדרים` : 'לא צוין'}</span>
                </div>
                
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span>{lead.move_in_date || 'לא צוין'}</span>
                </div>
              </div>

              {/* Features */}
              {(lead.features && lead.features.length > 0) && (
                <div>
                  <p className="text-sm font-medium mb-1">תכונות:</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFeatures(lead.features)}
                  </p>
                </div>
              )}

              {/* Boolean preferences */}
              <div className="flex flex-wrap gap-1">
                {lead.pets === true && <span className="inline-block rounded-md border border-brand-border bg-white px-2 py-1 text-xs">בעלי חיים</span>}
                {lead.furnished === true && <span className="inline-block rounded-md border border-brand-border bg-white px-2 py-1 text-xs">מרוהט</span>}
                {lead.mamad === true && <span className="inline-block rounded-md border border-brand-border bg-white px-2 py-1 text-xs">ממ״ד</span>}
                {lead.balcony === true && <span className="inline-block rounded-md border border-brand-border bg-white px-2 py-1 text-xs">מרפסת</span>}
              </div>

              <div className="border-t border-brand-border"></div>

              {/* Summary */}
              <div>
                <p className="text-sm font-medium mb-1">סיכום השיחה:</p>
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {lead.conversation_summary}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {lead.processing_status === 'pending' && (
                  <button
                    onClick={() => findMatches(lead.id)}
                    disabled={processingMatches === lead.id}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white hover:bg-brand-primaryMuted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Search className="w-4 h-4" />
                    {processingMatches === lead.id ? 'מחפש...' : 'מצא התאמות'}
                  </button>
                )}
                
                {lead.processing_status === 'processed' && lead.lead_id && (
                  <button
                    onClick={() => viewMatches(lead.id)}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-ink hover:bg-brand-bg"
                  >
                    <Eye className="w-4 h-4" />
                    צפה בהתאמות
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {leads.length === 0 && (
        <div className="text-center py-12">
          <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">אין לידים מוואטסאפ</h3>
          <p className="text-muted-foreground">
            לידים חדשים יופיעו כאן כשיתקבלו מהבוט
          </p>
        </div>
      )}
    </div>
  );
}
