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
  Loader2
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

export default function SharedPropertyPage() {
  const params = useParams();
  const token = params?.token as string;
  
  const [property, setProperty] = useState<SharedProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    async function fetchProperty() {
      try {
        const response = await fetch(`/api/v1/shares/${token}`);
        if (!response.ok) {
          throw new Error('לא נמצא נכס זה');
        }
        const data = await response.json();
        setProperty(data.property);
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
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                  {images.map((_: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        idx === currentImageIndex 
                          ? 'bg-white w-6' 
                          : 'bg-white/50'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
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

    </div>
  );
}

