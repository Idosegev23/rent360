'use client';

import { useState } from 'react';
import { type ExtendedProperty } from '../types/property';
import { Calendar, MapPin, Phone, Clock, Info, Building2, Check, Loader2, Trash2, MessageCircle, Target } from 'lucide-react';

interface PropertyCardProps {
  item: ExtendedProperty;
  showApproveButton?: boolean;
  showDeleteButton?: boolean;
  showOutreachButton?: boolean;
  onApproved?: (propertyId: string) => void;
  onDeleted?: (propertyId: string) => void;
  onOutreachSent?: (propertyId: string) => void;
}

export default function PropertyCard({ item, showApproveButton = false, showDeleteButton = false, showOutreachButton = false, onApproved, onDeleted, onOutreachSent }: PropertyCardProps) {
  const image = Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null;
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sendingOutreach, setSendingOutreach] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [justSentOutreach, setJustSentOutreach] = useState(false);

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/v1/properties/${item.id}/approve`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'מחיקה נכשלה');
      onDeleted?.(item.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'מחיקה נכשלה');
      setDeleting(false);
    }
  };

  const openConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmingDelete(true);
  };

  const closeConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmingDelete(false);
  };

  const handleSendOutreach = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (sendingOutreach || justSentOutreach || item.initial_message_sent) return;
    setSendingOutreach(true);
    setOutreachError(null);
    try {
      const res = await fetch('/api/v1/outreach/send-initial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: item.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'שליחה נכשלה');
      setJustSentOutreach(true);
      onOutreachSent?.(item.id);
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : 'שליחה נכשלה');
    } finally {
      setSendingOutreach(false);
    }
  };

  const outreachBlockReason: string | null = (() => {
    if (!showOutreachButton) return null;
    if (item.outreach_blocked) return 'בעל הנכס ביקש שלא לקבל פניות';
    if (item.initial_message_sent || justSentOutreach) return 'כבר נשלחה פנייה ראשונה';
    if (!item.contact_phone) return 'אין מספר טלפון';
    if (!item.contact_name) return 'אין שם של בעל הנכס — נא לתקן ידנית';
    if (!Array.isArray(item.images) || item.images.length === 0) return 'אין תמונות לדירה — נא להוסיף תמונה';
    return null;
  })();

  const handleApprove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (approving || justApproved || item.is_approved) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/v1/properties/${item.id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'אישור נכשל');
      setJustApproved(true);
      onApproved?.(item.id);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'אישור נכשל');
    } finally {
      setApproving(false);
    }
  };

  const isApproved = item.is_approved || justApproved;
  
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

        {/* Matches badge (top-left) */}
        {typeof item.matches_count === 'number' && item.matches_count > 0 && (
          <div
            className="absolute top-2 left-2 rounded-full bg-emerald-600/95 text-white px-2.5 py-1 text-xs font-semibold flex items-center gap-1 shadow"
            title={item.matches_top_score ? `ציון מקסימלי: ${Math.round(item.matches_top_score)}` : undefined}
          >
            <Target className="h-3 w-3" />
            {item.matches_count} שוכרים מתאימים
          </div>
        )}
        
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

        {/* Move-in Date — prefer evacuation_date, fall back to available_from */}
        {(item.evacuation_date || item.available_from) && (
          <div className="flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3 text-brand-inkMuted" />
            <span className="text-xs text-brand-inkMuted">
              כניסה: {formatEvacuationDate(item.evacuation_date || item.available_from || null)}
            </span>
          </div>
        )}

        {/* Approval line — only on approved-properties endpoint. Manual approvals show approver + date; questionnaire approvals show submission date. */}
        {item.approved_at && (
          <div className="flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3 text-brand-primary" />
            <span className="text-xs text-brand-primary font-medium">
              {item.approval_method === 'manual'
                ? `אישור ידני: ${formatEvacuationDate(item.approved_at)}${item.approved_by_name ? ` · ${item.approved_by_name}` : ''}`
                : `מילוי שאלון: ${formatEvacuationDate(item.approved_at)}`}
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

        {/* Outreach button (send WhatsApp template to landlord) */}
        {showOutreachButton && (
          <div className="mt-3 pt-3 border-t border-brand-border">
            {justSentOutreach || item.initial_message_sent ? (
              <div className="flex items-center justify-center gap-1.5 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
                <Check className="h-4 w-4" />
                <span>פנייה נשלחה</span>
              </div>
            ) : outreachBlockReason ? (
              <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 text-center" title={outreachBlockReason}>
                {outreachBlockReason}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSendOutreach}
                  disabled={sendingOutreach}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {sendingOutreach ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  <span>{sendingOutreach ? 'שולח...' : 'שלח פנייה ראשונה'}</span>
                </button>
                {outreachError && (
                  <p className="mt-1 text-xs text-red-600">{outreachError}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Approve button (manual phone-call approval flow) */}
        {showApproveButton && (
          <div className="mt-3 pt-3 border-t border-brand-border">
            {isApproved ? (
              <div className="flex items-center justify-center gap-1.5 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                <Check className="h-4 w-4" />
                <span>מאושר</span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approving}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>{approving ? 'מאשר...' : 'אשר תיווך'}</span>
                </button>
                {approveError && (
                  <p className="mt-1 text-xs text-red-600">{approveError}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Delete button (soft-delete from approved list) */}
        {showDeleteButton && (
          <div className="mt-3 pt-3 border-t border-brand-border">
            {confirmingDelete ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800 mb-2">למחוק את הנכס מרשימת המאושרים?</p>
                <p className="text-xs text-red-700 mb-3">פעולה זו תסיר את הנכס מהדף הזה ותסמן אותו כלא-פעיל. אפשר לשחזר ידנית.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    <span>{deleting ? 'מוחק...' : 'כן, מחק'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={closeConfirm}
                    disabled={deleting}
                    className="flex-1 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    ביטול
                  </button>
                </div>
                {deleteError && (
                  <p className="mt-2 text-xs text-red-700">{deleteError}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={openConfirm}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                <span>מחק נכס</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
