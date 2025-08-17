import { 
  Phone, 
  Mail, 
  MapPin, 
  DollarSign, 
  Home, 
  Calendar, 
  Star,
  MoreVertical 
} from 'lucide-react';

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

interface ModernLeadCardProps {
  lead: Lead;
}

export default function ModernLeadCard({ lead }: ModernLeadCardProps) {
  const name = lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'ללא שם';
  const isHotLead = (lead.budget_max || 0) > 8000;
  
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800';
      case 'contacted': return 'bg-yellow-100 text-yellow-800';
      case 'qualified': return 'bg-green-100 text-green-800';
      case 'converted': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'new': return 'חדש';
      case 'contacted': return 'יצרנו קשר';
      case 'qualified': return 'מוכשר';
      case 'converted': return 'הומר';
      default: return status || 'ללא סטטוס';
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('he-IL');
    } catch {
      return dateStr;
    }
  };

  const formatCities = (cities?: string[] | string) => {
    if (!cities) return '';
    if (typeof cities === 'string') return cities;
    if (Array.isArray(cities)) return cities.join(', ');
    return '';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-all duration-200 group">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-brand-primary to-brand-primaryMuted rounded-lg flex items-center justify-center text-white font-semibold text-lg">
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">{name}</h3>
            <p className="text-sm text-gray-500">נוצר {formatDate(lead.created_at)}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isHotLead && (
            <div className="p-1.5 bg-red-100 text-red-600 rounded-lg">
              <Star className="h-4 w-4 fill-current" />
            </div>
          )}
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(lead.status)}`}>
            {getStatusText(lead.status)}
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-3 mb-4">
        {lead.phone && (
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-green-100 text-green-600 rounded-lg">
              <Phone className="h-4 w-4" />
            </div>
            <a 
              href={`tel:${lead.phone}`}
              className="text-gray-700 hover:text-brand-primary transition-colors"
            >
              {lead.phone}
            </a>
          </div>
        )}
        
        {lead.email && (
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Mail className="h-4 w-4" />
            </div>
            <a 
              href={`mailto:${lead.email}`}
              className="text-gray-700 hover:text-brand-primary transition-colors truncate"
            >
              {lead.email}
            </a>
          </div>
        )}
      </div>

      {/* Requirements */}
      <div className="space-y-3 mb-4">
        {(lead.budget_min || lead.budget_max) && (
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-brand-primary/10 text-brand-primary rounded-lg">
              <DollarSign className="h-4 w-4" />
            </div>
            <span className="text-gray-700">
              ₪{(lead.budget_min || 0).toLocaleString()} - ₪{(lead.budget_max || 0).toLocaleString()}
            </span>
          </div>
        )}
        
        {lead.preferred_rooms && (
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
              <Home className="h-4 w-4" />
            </div>
            <span className="text-gray-700">{lead.preferred_rooms} חדרים</span>
          </div>
        )}
        
        {lead.preferred_cities && formatCities(lead.preferred_cities) && (
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
              <MapPin className="h-4 w-4" />
            </div>
            <span className="text-gray-700 truncate">{formatCities(lead.preferred_cities)}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
        <button className="flex-1 bg-brand-primary text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-brand-primaryMuted transition-colors">
          צור התאמות
        </button>
        <button className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
          שלח הודעה
        </button>
        <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Hot Lead Indicator */}
      {isHotLead && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-red-600 fill-current" />
            <span className="text-xs font-medium text-red-700">ליד חם - תקציב גבוה</span>
          </div>
        </div>
      )}
    </div>
  );
}