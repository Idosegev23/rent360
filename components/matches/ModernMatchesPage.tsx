'use client';

import { useState, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Target,
  Users,
  Home,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  MessageSquare,
  Eye,
  Settings,
  BarChart3
} from 'lucide-react';
import Link from 'next/link';

interface MatchData {
  lead_id: string;
  property_id: string;
  lead: {
    id: string;
    full_name: string;
    phone: string;
    budget_min: number;
    budget_max: number;
    preferred_cities: string[];
    preferred_rooms: number;
    required_fields: Record<string, boolean>;
    move_in_from: string;
  };
  property: {
    id: string;
    title: string;
    city: string;
    neighborhood: string;
    price: number;
    rooms: number;
    sqm: number;
    amenities: Record<string, boolean>;
    images: string[];
    available_from: string;
  };
  score: number;
  percentage: number;
  isDisqualified: boolean;
  disqualifyingReasons: string[];
  breakdown: {
    price: { score: number; weight: number; note: string };
    location: { score: number; weight: number; note: string };
    rooms: { score: number; weight: number; note: string };
    amenities: { score: number; weight: number; note: string };
    moveIn: { score: number; weight: number; note: string };
  };
  reasons: Array<{
    factor: string;
    impact: number;
    note: string;
    isMandatory?: boolean;
    matches?: boolean;
  }>;
}

export default function ModernMatchesPage() {
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedMatch, setSelectedMatch] = useState<MatchData | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    fetchMatches();
  }, []);

  const fetchMatches = async () => {
    try {
      const response = await fetch('/api/v1/matches');
      const data = await response.json();
      setMatches(data.matches || []);
      setDebugInfo(data.debug);
      console.log('Matches debug info:', data.debug);
    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredMatches = matches.filter(match => {
    const matchesSearch = 
      match.lead.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      match.property.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      match.property.city.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesScore = scoreFilter === 'all' || (() => {
      switch (scoreFilter) {
        case 'high': return match.score >= 80;
        case 'medium': return match.score >= 50 && match.score < 80;
        case 'low': return match.score > 0 && match.score < 50;
        case 'disqualified': return match.isDisqualified;
        default: return true;
      }
    })();

    const matchesStatus = statusFilter === 'all' || (() => {
      switch (statusFilter) {
        case 'qualified': return !match.isDisqualified;
        case 'disqualified': return match.isDisqualified;
        default: return true;
      }
    })();

    return matchesSearch && matchesScore && matchesStatus;
  });

  const totalMatches = matches.length;
  const qualifiedMatches = matches.filter(m => !m.isDisqualified).length;
  const disqualifiedMatches = matches.filter(m => m.isDisqualified).length;
  const highQualityMatches = matches.filter(m => !m.isDisqualified && m.score >= 80).length;

  const getScoreColor = (score: number, isDisqualified: boolean) => {
    if (isDisqualified) return 'text-red-600 bg-red-100';
    if (score >= 80) return 'text-green-600 bg-green-100';
    if (score >= 50) return 'text-yellow-600 bg-yellow-100';
    return 'text-orange-600 bg-orange-100';
  };

  const getScoreBadge = (score: number, isDisqualified: boolean) => {
    if (isDisqualified) return 'נפסל';
    if (score >= 80) return 'מעולה';
    if (score >= 50) return 'טוב';
    return 'בינוני';
  };

  if (loading) {
    return (
      <main className="pb-20 space-y-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
          <span className="mr-3 text-gray-600">טוען התאמות...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="pb-20 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">התאמות</h1>
          <p className="text-gray-600 mt-1">התאמה אוטומטית בין לידים לנכסים</p>
        </div>
        <button className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-primaryMuted transition-colors">
          <Settings className="h-5 w-5" />
          הגדרות התאמה
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-brand-bg to-orange-50 rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary text-white rounded-lg">
              <Target className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">סך הכל התאמות</p>
              <p className="text-2xl font-bold text-brand-accent">{totalMatches}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-brand-bg rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-success text-white rounded-lg">
              <CheckCircle className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">התאמות כשירות</p>
              <p className="text-2xl font-bold text-brand-accent">{qualifiedMatches}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-6 border border-orange-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-warning text-white rounded-lg">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">התאמות איכותיות</p>
              <p className="text-2xl font-bold text-brand-accent">{highQualityMatches}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-xl p-6 border border-red-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-500 text-white rounded-lg">
              <XCircle className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-red-600">התאמות נפסלות</p>
              <p className="text-2xl font-bold text-red-700">{disqualifiedMatches}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="חיפוש לפי שם ליד או נכס..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
            
            <select
              value={scoreFilter}
              onChange={(e) => setScoreFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל הציונים</option>
              <option value="high">גבוה (80%+)</option>
              <option value="medium">בינוני (50-80%)</option>
              <option value="low">נמוך (1-50%)</option>
              <option value="disqualified">נפסל (0%)</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל הסטטוסים</option>
              <option value="qualified">כשיר</option>
              <option value="disqualified">נפסל</option>
            </select>

            {(searchTerm || scoreFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setScoreFilter('all');
                  setStatusFilter('all');
                }}
                className="px-4 py-3 text-brand-primary border border-brand-primary rounded-lg hover:bg-brand-primary hover:text-white transition-colors"
              >
                נקה פילטרים
              </button>
            )}
          </div>

          <div className="text-sm text-gray-600">
            מציג {filteredMatches.length} מתוך {totalMatches} התאמות
          </div>
        </div>
      </div>

      {/* Matches List */}
      {filteredMatches.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Target className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {totalMatches === 0 ? 'אין התאמות במערכת' : 'לא נמצאו התאמות'}
          </h3>
          <p className="text-gray-600 mb-4">
            {totalMatches === 0 
              ? 'יש צורך בלידים ונכסים פעילים כדי ליצור התאמות'
              : 'נסה לשנות את הפילטרים או החיפוש'
            }
          </p>
          
          {/* Debug Info */}
          {debugInfo && totalMatches === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-md mx-auto text-right">
              <h4 className="font-medium text-gray-700 mb-2">מידע טכני</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <div>לידים במערכת: {debugInfo.leadsCount}</div>
                <div>נכסים פעילים: {debugInfo.propertiesCount}</div>
                <div>קומבינציות אפשריות: {debugInfo.totalCombinations}</div>
                {debugInfo.leadsCount === 0 && (
                  <div className="text-red-600 mt-2">⚠️ אין לידים פעילים במערכת</div>
                )}
                {debugInfo.propertiesCount === 0 && (
                  <div className="text-red-600 mt-2">⚠️ אין נכסים פעילים במערכת</div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMatches.map((match, index) => (
            <div
              key={`${match.lead_id}-${match.property_id}`}
              className={`bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow ${
                match.isDisqualified ? 'border-red-200 bg-red-50' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                {/* Left Side - Match Info */}
                <div className="flex-1 space-y-4">
                  {/* Score and Status */}
                  <div className="flex items-center gap-4">
                    <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getScoreColor(match.score, match.isDisqualified)}`}>
                      {match.isDisqualified ? (
                        <XCircle className="h-4 w-4 ml-1" />
                      ) : (
                        <CheckCircle className="h-4 w-4 ml-1" />
                      )}
                      {match.score}% • {getScoreBadge(match.score, match.isDisqualified)}
                    </div>
                    
                    {match.isDisqualified && (
                      <div className="flex items-center gap-1 text-red-600 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        נפסל עקב דרישות חובה
                      </div>
                    )}
                  </div>

                  {/* Lead and Property Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Lead Info */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Users className="h-4 w-4" />
                        <span className="font-medium">ליד</span>
                      </div>
                      <div>
                        <Link 
                          href={`/leads`}
                          className="text-lg font-semibold text-brand-primary hover:text-brand-primaryMuted"
                        >
                          {match.lead.full_name}
                        </Link>
                        <p className="text-sm text-gray-600">{match.lead.phone}</p>
                        <p className="text-sm text-gray-600">
                          תקציב: ₪{match.lead.budget_min?.toLocaleString()} - ₪{match.lead.budget_max?.toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-600">
                          חדרים: {match.lead.preferred_rooms} • ערים: {match.lead.preferred_cities?.join(', ')}
                        </p>
                      </div>
                    </div>

                    {/* Property Info */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Home className="h-4 w-4" />
                        <span className="font-medium">נכס</span>
                      </div>
                      <div>
                        <Link 
                          href={`/properties/${match.property.id}`}
                          className="text-lg font-semibold text-brand-primary hover:text-brand-primaryMuted"
                        >
                          {match.property.title}
                        </Link>
                        <p className="text-sm text-gray-600">{match.property.city} • {match.property.neighborhood}</p>
                        <p className="text-sm text-gray-600">
                          ₪{match.property.price?.toLocaleString()} • {match.property.rooms} חדרים • {match.property.sqm} מ״ר
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Disqualifying Reasons */}
                  {match.isDisqualified && match.disqualifyingReasons.length > 0 && (
                    <div className="bg-red-100 border border-red-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        סיבות פסילה
                      </div>
                      <ul className="text-sm text-red-600 space-y-1">
                        {match.disqualifyingReasons.map((reason, idx) => (
                          <li key={idx}>• {reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Score Breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-gray-200">
                    <div className="text-center">
                      <div className="text-xs text-gray-500">מחיר</div>
                      <div className="text-sm font-medium">{match.breakdown.price.score}%</div>
                      <div className="text-xs text-gray-400">{match.breakdown.price.note}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500">מיקום</div>
                      <div className="text-sm font-medium">{match.breakdown.location.score}%</div>
                      <div className="text-xs text-gray-400">{match.breakdown.location.note}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500">חדרים</div>
                      <div className="text-sm font-medium">{match.breakdown.rooms.score}%</div>
                      <div className="text-xs text-gray-400">{match.breakdown.rooms.note}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500">דרישות</div>
                      <div className="text-sm font-medium">{match.breakdown.amenities.score}%</div>
                      <div className="text-xs text-gray-400">{match.breakdown.amenities.note}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-500">תאריך כניסה</div>
                      <div className="text-sm font-medium">{match.breakdown.moveIn.score}%</div>
                      <div className="text-xs text-gray-400">{match.breakdown.moveIn.note}</div>
                    </div>
                  </div>
                </div>

                {/* Right Side - Actions */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setSelectedMatch(match)}
                    className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <BarChart3 className="h-4 w-4" />
                    פירוט
                  </button>
                  
                  {!match.isDisqualified && (
                    <form action="/api/v1/messages/send" method="post">
                      <input type="hidden" name="lead_id" value={match.lead_id} />
                      <input type="hidden" name="property_id" value={match.property_id} />
                      <input type="hidden" name="template" value={'היי {{full_name}}, יש לי נכס מושלם בשבילך ב{{city}} {{neighborhood}} במחיר {{price}} ₪, {{rooms}} חדרים, {{sqm}} מ"ר. לפרטים נוספים: {{link}}'} />
                      <button 
                        type="submit"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm bg-brand-primary text-white rounded-lg hover:bg-brand-primaryMuted transition-colors"
                      >
                        <MessageSquare className="h-4 w-4" />
                        שלח הודעה
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Match Details Modal */}
      {selectedMatch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">פירוט התאמה מלא</h3>
                <button
                  onClick={() => setSelectedMatch(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Score Summary */}
              <div className="text-center">
                <div className={`inline-flex items-center px-4 py-2 rounded-full text-lg font-bold ${getScoreColor(selectedMatch.score, selectedMatch.isDisqualified)}`}>
                  {selectedMatch.score}% התאמה
                </div>
                <p className="text-gray-600 mt-2">{getScoreBadge(selectedMatch.score, selectedMatch.isDisqualified)}</p>
              </div>

              {/* Detailed Breakdown */}
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">פירוט ציונים</h4>
                {Object.entries(selectedMatch.breakdown).map(([key, data]) => {
                  const labels: Record<string, string> = {
                    price: 'מחיר',
                    location: 'מיקום', 
                    rooms: 'חדרים',
                    amenities: 'דרישות',
                    moveIn: 'תאריך כניסה'
                  };
                  
                  return (
                    <div key={key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <div className="font-medium">{labels[key]}</div>
                        <div className="text-sm text-gray-600">{data.note}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{data.score}%</div>
                        <div className="text-xs text-gray-500">משקל: {data.weight}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mandatory Requirements */}
              {selectedMatch.reasons.filter(r => r.isMandatory).length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-900">דרישות חובה</h4>
                  <div className="space-y-2">
                    {selectedMatch.reasons
                      .filter(r => r.isMandatory)
                      .map((reason, idx) => (
                        <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg ${
                          reason.matches ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {reason.matches ? 
                            <CheckCircle className="h-5 w-5 text-green-600" /> : 
                            <XCircle className="h-5 w-5 text-red-600" />
                          }
                          <span>{reason.note}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}