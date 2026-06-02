'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Home,
  MapPin,
  DollarSign,
  Maximize,
  Calendar,
  Check,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import Image from 'next/image';

interface SharedProperty {
  id: string;
  title: string;
  city: string;
  neighborhood: string | null;
  price: number;
  rooms: number | null;
  sqm: number | null;
  amenities: any;
  available_from: string | null;
  images: any;
  description: string | null;
  highlights: string[] | null;
  type: string | null;
  pets_allowed: boolean | null;
  smokers_allowed: boolean | null;
  long_term: boolean | null;
}

interface MatchInfo {
  percentage: number;
  matches: string[];
  missing: string[];
}

export default function SharedPropertyPage() {
  const params = useParams();
  const token = params?.token as string;

  const [property, setProperty] = useState<SharedProperty | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [interested, setInterested] = useState(false);
  const [sendingInterest, setSendingInterest] = useState(false);

  async function expressInterest() {
    if (sendingInterest || interested) return;
    setSendingInterest(true);
    try {
      const res = await fetch(`/api/v1/shares/${token}/interest`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      setInterested(true);
    } catch {
      alert('משהו השתבש, נסו שוב בעוד רגע');
    } finally {
      setSendingInterest(false);
    }
  }

  useEffect(() => {
    async function fetchProperty() {
      try {
        const response = await fetch(`/api/v1/shares/${token}`);
        if (!response.ok) {
          throw new Error('לא נמצא נכס זה');
        }
        const data = await response.json();
        setProperty(data.property);
        setMatch(data.match || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינת הנכס');
      } finally {
        setLoading(false);
      }
    }

    fetchProperty();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-600">טוען נכס...</p>
        </div>
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <Home className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">נכס לא נמצא</h2>
          <p className="text-gray-600">{error || 'הקישור אינו תקף או פג תוקפו'}</p>
        </div>
      </div>
    );
  }

  const images = property.images || [];
  const hasImages = Array.isArray(images) && images.length > 0;
  
  const amenitiesList = property.amenities ? [
    { key: 'elevator', label: 'מעלית', icon: '🛗' },
    { key: 'parking', label: 'חניה', icon: '🅿️' },
    { key: 'balcony', label: 'מרפסת', icon: '🏡' },
    { key: 'mamad', label: 'ממ״ד', icon: '🛡️' },
    { key: 'air_conditioning', label: 'מיזוג אוויר', icon: '❄️' },
    { key: 'furnished', label: 'מרוהט', icon: '🛋️' },
    { key: 'accessibility', label: 'נגיש לנכים', icon: '♿' },
    { key: 'storage', label: 'מחסן', icon: '📦' },
  ].filter(item => property.amenities[item.key]) : [];

  // Clean location data - remove unwanted details
  const cleanLocation = (text: string | null): string | null => {
    if (!text) return null;
    
    return text
      // Remove common suffixes
      .replace(/\s*-\s*מגורים/g, '')
      .replace(/\s*-\s*משרדים/g, '')
      .replace(/\s*-\s*rent/gi, '')
      // Remove street numbers and floor info
      .replace(/\s+\d+\s*קומה\s*\d+/g, '')
      .replace(/קומה\s*\d+/g, '')
      .replace(/\s+\d+$/g, '') // numbers at end
      // Remove specific street names with numbers (like "נוגה 17")
      .replace(/[א-ת]+\s+\d+/g, '')
      .trim();
  };

  // Show only city and neighborhood (cleaned)
  const locationText = [
    cleanLocation(property.city),
    cleanLocation(property.neighborhood)
  ].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2">
            <Home className="h-6 w-6 text-orange-500" />
            <span className="font-bold text-xl text-gray-900">Rent360</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Image Gallery */}
        {hasImages && (
          <div className="bg-white rounded-xl overflow-hidden shadow-sm">
            <div className="relative aspect-video bg-gray-100">
              <Image
                src={images[currentImageIndex]}
                alt={property.title}
                fill
                className="object-cover"
                unoptimized
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="הקודם"
                    onClick={() => setCurrentImageIndex(i => (i - 1 + images.length) % images.length)}
                    className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    aria-label="הבא"
                    onClick={() => setCurrentImageIndex(i => (i + 1) % images.length)}
                    className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <div className="absolute top-3 left-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white">
                    {currentImageIndex + 1}/{images.length}
                  </div>
                  <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
                    {images.map((_: any, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        aria-label={`תמונה ${idx + 1}`}
                        onClick={() => setCurrentImageIndex(idx)}
                        className={`h-2.5 rounded-full transition-all ${idx === currentImageIndex ? 'w-6 bg-white' : 'w-2.5 bg-white/50'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-3">
                {images.map((img: string, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`מעבר לתמונה ${idx + 1}`}
                    onClick={() => setCurrentImageIndex(idx)}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 ${idx === currentImageIndex ? 'border-orange-500' : 'border-transparent'}`}
                  >
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Property Header */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">{property.title}</h1>
          
          <div className="flex items-center gap-2 text-gray-600 mb-4">
            <MapPin className="h-5 w-5 text-orange-500" />
            <span>{locationText}</span>
          </div>

          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-3xl font-bold text-orange-500">
              ₪{property.price?.toLocaleString()}
            </span>
            <span className="text-gray-600">לחודש</span>
          </div>

          {/* Key Stats */}
          <div className="grid grid-cols-3 gap-4">
            {property.rooms && (
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900">{property.rooms}</div>
                <div className="text-sm text-gray-600">חדרים</div>
              </div>
            )}
            {property.sqm && (
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-900">{property.sqm}</div>
                <div className="text-sm text-gray-600">מ״ר</div>
              </div>
            )}
          </div>
        </div>

        {/* Personalized match — only when the link was sent to a specific renter */}
        {match && (
          <div className="bg-white rounded-xl shadow-sm p-6 border-2 border-emerald-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">ההתאמה שלך</h2>
              <span className="rounded-full bg-emerald-500 text-white font-bold text-sm px-3 py-1">{match.percentage}% התאמה</span>
            </div>
            {match.matches.length > 0 && (
              <ul className="space-y-2 mb-4">
                {match.matches.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-800">{m}</span>
                  </li>
                ))}
              </ul>
            )}
            {match.missing.length > 0 && (
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-sm font-medium text-gray-700 mb-2">כדאי לדעת — מה חסר:</div>
                <ul className="space-y-1.5">
                  {match.missing.map((m, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <X className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-600 text-sm">{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* AI Highlights */}
        {property.highlights && property.highlights.length > 0 && (
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl shadow-sm p-6 border border-orange-200">
            <h2 className="text-lg font-bold text-gray-900 mb-4">נקודות מפתח</h2>
            <ul className="space-y-2">
              {property.highlights.map((highlight, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Check className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-800">{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Description */}
        {property.description && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">תיאור</h2>
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{property.description}</p>
          </div>
        )}

        {/* Amenities */}
        {amenitiesList.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">מה יש בנכס?</h2>
            <div className="grid grid-cols-2 gap-3">
              {amenitiesList.map((amenity) => (
                <div key={amenity.key} className="flex items-center gap-2">
                  <span className="text-xl">{amenity.icon}</span>
                  <span className="text-gray-700">{amenity.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Additional Info */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">פרטים נוספים</h2>
          <div className="space-y-3">
            {property.available_from && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">תאריך כניסה</span>
                <span className="font-medium text-gray-900">
                  {new Date(property.available_from).toLocaleDateString('he-IL')}
                </span>
              </div>
            )}
            {property.type && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">סוג נכס</span>
                <span className="font-medium text-gray-900">{property.type}</span>
              </div>
            )}
            {property.pets_allowed !== null && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">חיות מחמד</span>
                <span className="flex items-center gap-1">
                  {property.pets_allowed ? (
                    <>
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-green-600">מותר</span>
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4 text-red-600" />
                      <span className="text-red-600">לא מותר</span>
                    </>
                  )}
                </span>
              </div>
            )}
            {property.long_term !== null && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">משך שכירות</span>
                <span className="font-medium text-gray-900">
                  {property.long_term ? 'ארוך טווח' : 'קצר טווח'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky CTA — express interest in viewing the apartment */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur p-4">
        <div className="mx-auto max-w-4xl">
          {interested ? (
            <div className="flex items-center justify-center gap-2 py-2 font-semibold text-emerald-700">
              <Check className="h-5 w-5" /> תודה! קיבלנו את הבקשה וניצור איתך קשר בקרוב.
            </div>
          ) : (
            <button
              type="button"
              onClick={expressInterest}
              disabled={sendingInterest}
              className="w-full rounded-xl bg-orange-500 py-3.5 text-center text-lg font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60"
            >
              {sendingInterest ? 'שולח…' : 'מעוניין/ת לראות את הדירה'}
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

