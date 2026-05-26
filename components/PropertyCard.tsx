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

  const openConfirm = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setConfirmingDelete(true); };
  const closeConfirm = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setConfirmingDelete(false); };

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'מיידי';
    try { return new Date(dateStr).toLocaleDateString('he-IL'); } catch { return dateStr; }
  };

  const getAmenitiesList = () => {
    if (!item.amenities) return [];
    const a = [];
    if (item.amenities.elevator) a.push('מעלית');
    if (item.amenities.parking) a.push('חניה');
    if (item.amenities.balcony) a.push('מרפסת');
    if (item.amenities.airConditioner) a.push('מזגן');
    if (item.amenities.storage) a.push('מחסן');
    if (item.amenities.mamad) a.push('ממ״ד');
    return a;
  };

  const amenities = getAmenitiesList();
  const isBrokerage = item.source && item.source.includes('יד 2 תיווך');

  return (
    <div className="prop-card">
      {/* Photo */}
      <div className="photo">
        {image ? (
          <img src={image} alt={item.title} />
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-4)', fontSize: 13 }}>אין תמונה</div>
        )}

        {/* Corner badges */}
        <div className="corner" style={{ display: 'flex', gap: 6 }}>
          {item.status && <span className="pill pill-green">{item.status}</span>}
          {isBrokerage && (
            <span className="pill pill-brand"><Building2 size={11} />תיווך</span>
          )}
        </div>

        {/* Matches badge (top-end) */}
        {typeof item.matches_count === 'number' && item.matches_count > 0 && (
          <div
            style={{
              position: 'absolute', top: 12, insetInlineEnd: 12, zIndex: 2,
              background: 'rgba(20, 130, 110, 0.92)', color: '#fff',
              borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              boxShadow: 'var(--sh-2)',
            }}
            title={item.matches_top_score ? `ציון מקסימלי: ${Math.round(item.matches_top_score)}` : undefined}
          >
            <Target size={11} />
            {item.matches_count} מתאימים
          </div>
        )}

        {/* Price overlay */}
        <div className="price-overlay">
          ₪{Number(item.price || 0).toLocaleString('he-IL')}
          <small>/ חודש</small>
        </div>

        {/* Images count */}
        {item.images && item.images.length > 1 && (
          <div style={{ position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
            {item.images.length} תמונות
          </div>
        )}
      </div>

      {/* Body */}
      <div className="body">
        <div className="ttl" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.title}
        </div>
        <div className="loc">
          <MapPin size={11} style={{ display: 'inline', marginInlineEnd: 4, verticalAlign: '-1px' }} />
          {item.neighborhood && <span>{item.neighborhood} · </span>}
          {item.city}
          {item.address && <span style={{ color: 'var(--ink-4)' }}> · {item.address}</span>}
        </div>

        {/* Specs */}
        <div className="specs">
          <span><strong>{item.rooms || '—'}</strong> חדרים</span>
          <span><strong>{item.sqm || '—'}</strong> מ״ר</span>
          {(item.evacuation_date || item.available_from) && (
            <span style={{ marginInlineStart: 'auto', color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={11} />
              {formatDate(item.evacuation_date || item.available_from || null)}
            </span>
          )}
        </div>

        {/* Approval line */}
        {item.approved_at && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--brand-deep)', fontWeight: 600 }}>
            <Check size={12} />
            {item.approval_method === 'manual'
              ? `אישור ידני · ${formatDate(item.approved_at)}${item.approved_by_name ? ` · ${item.approved_by_name}` : ''}`
              : `שאלון · ${formatDate(item.approved_at)}`}
          </div>
        )}

        {/* Contact */}
        {item.contact_name && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Phone size={11} />
            <span>{item.contact_name}{item.contact_phone && ` · ${item.contact_phone}`}</span>
          </div>
        )}

        {/* Amenities */}
        {amenities.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {amenities.slice(0, 3).map((a, i) => (
              <span key={i} className="pill pill-blue" style={{ fontSize: 10.5 }}>{a}</span>
            ))}
            {amenities.length > 3 && <span className="pill pill-outline" style={{ fontSize: 10.5 }}>+{amenities.length - 3}</span>}
          </div>
        )}

        {/* Source / updated */}
        {(item.source || item.last_updated_external) && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--ink-4)' }}>
            {item.source && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Info size={10} />{item.source}</span>}
            {item.last_updated_external && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={10} />עודכן {item.last_updated_external}</span>}
          </div>
        )}

        {/* Outreach button */}
        {showOutreachButton && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {justSentOutreach || item.initial_message_sent ? (
              <div className="pill pill-blue" style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', fontSize: 12.5 }}>
                <Check size={13} />
                <span>פנייה נשלחה</span>
              </div>
            ) : outreachBlockReason ? (
              <div className="pill pill-outline" style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', fontSize: 11.5, textAlign: 'center' }} title={outreachBlockReason}>
                {outreachBlockReason}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSendOutreach}
                  disabled={sendingOutreach}
                  className="btn btn-brand"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {sendingOutreach ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                  <span>{sendingOutreach ? 'שולח...' : 'שלח פנייה ראשונה'}</span>
                </button>
                {outreachError && <p style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{outreachError}</p>}
              </>
            )}
          </div>
        )}

        {/* Approve button */}
        {showApproveButton && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {isApproved ? (
              <div className="pill pill-green" style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', fontSize: 12.5 }}>
                <Check size={13} />
                <span>מאושר</span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approving}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {approving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>{approving ? 'מאשר...' : 'אשר תיווך'}</span>
                </button>
                {approveError && <p style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{approveError}</p>}
              </>
            )}
          </div>
        )}

        {/* Delete button */}
        {showDeleteButton && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            {confirmingDelete ? (
              <div style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--red-soft)', background: 'var(--red-soft)', padding: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', margin: '0 0 6px' }}>למחוק את הנכס מרשימת המאושרים?</p>
                <p style={{ fontSize: 11.5, color: 'var(--red)', margin: '0 0 10px' }}>הנכס יסומן כלא-פעיל. אפשר לשחזר ידנית.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={handleConfirmDelete} disabled={deleting} className="btn" style={{ flex: 1, background: 'var(--red)', color: 'white', justifyContent: 'center' }}>
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    <span>{deleting ? 'מוחק...' : 'כן, מחק'}</span>
                  </button>
                  <button type="button" onClick={closeConfirm} disabled={deleting} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>ביטול</button>
                </div>
                {deleteError && <p style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>{deleteError}</p>}
              </div>
            ) : (
              <button type="button" onClick={openConfirm} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--red)', borderColor: 'var(--red-soft)' }}>
                <Trash2 size={14} />
                <span>מחק נכס</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
