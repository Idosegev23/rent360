import { type ExtendedProperty } from '../types/property';
import { Calendar, MapPin, Phone, Clock, Info, Building2 } from 'lucide-react';

interface PropertyCardProps {
  item: ExtendedProperty;
}

export default function PropertyCard({ item }: PropertyCardProps) {
  const image = Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null;
  
  // Format evacuation date
  const formatEvacuationDate = (dateStr: string | null) => {
    if (!dateStr) return 'מיידי';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('he-IL');
    } catch {
      return dateStr;
    }
  };

  // Format amenities list
  const getAmenitiesList = () => {
    if (!item.amenities) return [];
    const amenities = [];
    if (item.amenities.elevator) amenities.push('מעלית');
    if (item.amenities.parking) amenities.push('חניה');
    if (item.amenities.balcony) amenities.push('מרפסת');
    if (item.amenities.airConditioner) amenities.push('מזגן');
    if (item.amenities.storage) amenities.push('מחסן');
    if (item.amenities.mamad) amenities.push('ממ״ד');
    return amenities;
  };

  const amenities = getAmenitiesList();
  
  // Check if this is a brokerage property
  const isBrokerage = item.source && item.source.includes('יד 2 תיווך');

  return (
    <div className="overflow-hidden rounded-lg border border-brand-border bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Image Section */}
      <div className="aspect-[16/9] w-full bg-brand-bg relative">
        {image ? (
          <img src={image} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-brand-inkMuted">אין תמונה</div>
        )}
        
        {/* Status Badge */}
        <div className="absolute top-2 right-2 flex gap-2">
          {item.status && (
            <div className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
              {item.status}
            </div>
          )}
          {isBrokerage && (
            <div className="rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              תיווך
            </div>
          )}
        </div>
        
        {/* Images Count */}
        {item.images && item.images.length > 1 && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs text-white">
            {item.images.length} תמונות
          </div>
        )}
      </div>

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="line-clamp-2 text-base font-semibold leading-tight">{item.title}</h3>
          <span className="shrink-0 rounded-md bg-brand-bg px-2 py-0.5 text-xs text-brand-inkMuted">{item.city}</span>
        </div>

        {/* Address */}
        {(item.neighborhood || item.address) && (
          <div className="flex items-center gap-1 mb-3">
            <MapPin className="h-3 w-3 text-brand-inkMuted" />
            <div className="line-clamp-1 text-sm text-brand-inkMuted">
              {item.neighborhood && <span>{item.neighborhood}</span>}
              {item.neighborhood && item.address && <span> • </span>}
              {item.address && <span>{item.address}</span>}
            </div>
          </div>
        )}

        {/* Price and Basic Info */}
        <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
          <span className="rounded-md bg-brand-primary/10 px-2 py-0.5 font-semibold text-brand-primary">
            ₪{Number(item.price || 0).toLocaleString()}
          </span>
          <span className="rounded-md bg-brand-bg px-2 py-0.5">{item.rooms || '—'} חדרים</span>
          <span className="rounded-md bg-brand-bg px-2 py-0.5">{item.sqm || '—'} מ״ר</span>
        </div>

        {/* Evacuation Date */}
        {item.evacuation_date && (
          <div className="flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3 text-brand-inkMuted" />
            <span className="text-xs text-brand-inkMuted">
              כניסה: {formatEvacuationDate(item.evacuation_date)}
            </span>
          </div>
        )}

        {/* Contact */}
        {item.contact_name && (
          <div className="flex items-center gap-1 mb-2">
            <Phone className="h-3 w-3 text-brand-inkMuted" />
            <span className="text-xs text-brand-inkMuted">
              {item.contact_name}
              {item.contact_phone && ` • ${item.contact_phone}`}
            </span>
          </div>
        )}

        {/* Amenities */}
        {amenities.length > 0 && (
          <div className="mb-2">
            <div className="flex flex-wrap gap-1">
              {amenities.slice(0, 3).map((amenity, index) => (
                <span key={index} className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                  {amenity}
                </span>
              ))}
              {amenities.length > 3 && (
                <span className="rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                  +{amenities.length - 3} נוספים
                </span>
              )}
            </div>
          </div>
        )}

        {/* Source and Last Updated */}
        <div className="flex items-center justify-between text-xs text-brand-inkMuted">
          {item.source && (
            <div className="flex items-center gap-1">
              <Info className="h-3 w-3" />
              <span>{item.source}</span>
            </div>
          )}
          {item.last_updated_external && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>עודכן {item.last_updated_external}</span>
            </div>
          )}
        </div>

        {/* Timeline indicator */}
        {item.timeline && item.timeline.length > 0 && (
          <div className="mt-2 pt-2 border-t border-brand-border">
            <div className="text-xs text-brand-inkMuted">
              {item.timeline.length} עדכונים אחרונים
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
