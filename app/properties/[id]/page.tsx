'use client';

import { useEffect, useState } from 'react'
import { ExtendedProperty } from '../../../types/property'
import { Calendar, MapPin, Phone, Clock, Info, ChevronLeft } from 'lucide-react'
import PropertyImageGallery from '../../../components/PropertyImageGallery'

async function fetchProperty(id: string): Promise<ExtendedProperty | null> {
  try {
    const response = await fetch(`/api/v1/properties/${id}`)
    if (!response.ok) return null
    const data = await response.json()
  return data
  } catch (error) {
    console.error('Error fetching property:', error)
    return null
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'מיידי';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL');
  } catch {
    return dateStr;
  }
}

function getAmenitiesDisplay(amenities: any) {
  if (!amenities) return '—';
  const amenitiesList = [];
  if (amenities.elevator) amenitiesList.push('מעלית');
  if (amenities.parking) amenitiesList.push('חניה');
  if (amenities.balcony) amenitiesList.push('מרפסת');
  if (amenities.airConditioner) amenitiesList.push('מזגן');
  if (amenities.storage) amenitiesList.push('מחסן');
  if (amenities.mamad) amenitiesList.push('ממ״ד');
  
  return amenitiesList.length > 0 ? amenitiesList.join(' · ') : '—';
}

export default function PropertyPage({ params }: { params: { id: string } }) {
  const [item, setItem] = useState<ExtendedProperty | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadProperty = async () => {
      try {
        const property = await fetchProperty(params.id)
        setItem(property)
      } catch (error) {
        console.error('Error loading property:', error)
      } finally {
        setLoading(false)
      }
    }

    loadProperty()
  }, [params.id])

  if (loading) {
    return (
      <main className="pb-20 max-w-4xl mx-auto px-4">
        <div className="space-y-8 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
          <div className="aspect-[16/10] bg-gray-200 rounded-xl"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-32 bg-gray-200 rounded-xl"></div>
              <div className="h-24 bg-gray-200 rounded-xl"></div>
            </div>
            <div className="space-y-6">
              <div className="h-24 bg-gray-200 rounded-xl"></div>
              <div className="h-16 bg-gray-200 rounded-xl"></div>
            </div>
          </div>
        </div>
      </main>
    )
  }
  
  if (!item) {
    return (
      <main className="pb-20 max-w-4xl mx-auto px-4">
        <h1 className="mb-4 text-2xl font-bold">נכס</h1>
        <div className="text-brand-inkMuted">נכס לא נמצא</div>
      </main>
    )
  }

  return (
    <main className="pb-20 space-y-8 max-w-4xl mx-auto px-4">
      {/* Header Section */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold leading-tight text-gray-900">{item.title}</h1>
          {item.status && (
            <div className="inline-block rounded-lg bg-green-100 px-4 py-2 text-sm font-medium text-green-800 shadow-sm">
              {item.status}
            </div>
          )}
        </div>
        
        {/* Quick Info Bar */}
        <div className="flex flex-wrap items-center gap-6 text-lg">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-brand-primary">₪{Number(item.price || 0).toLocaleString()}</span>
            <span className="text-gray-500">לחודש</span>
          </div>
          {item.rooms && (
            <div className="flex items-center gap-1 text-gray-700">
              <span className="font-semibold">{item.rooms}</span>
              <span>חדרים</span>
            </div>
          )}
          {item.sqm && (
            <div className="flex items-center gap-1 text-gray-700">
              <span className="font-semibold">{item.sqm}</span>
              <span>מ״ר</span>
            </div>
          )}
          {(item.city || item.neighborhood) && (
            <div className="flex items-center gap-2 text-gray-600">
              <MapPin className="h-5 w-5" />
              <span>{item.city}{item.neighborhood && ` · ${item.neighborhood}`}</span>
            </div>
          )}
        </div>
      </div>

      {/* Image Gallery */}
      {Array.isArray(item.images) && item.images.length > 0 && (
        <PropertyImageGallery images={item.images} title={item.title} />
      )}

      {/* Property Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-8">
          {/* Location & Basic Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <h3 className="text-xl font-semibold mb-6 text-gray-900">פרטי הנכס</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  מיקום
                </div>
                <div className="text-lg font-medium text-gray-900">
                  {item.city}
                  {item.neighborhood && ` · ${item.neighborhood}`}
                </div>
                {item.address && (
                  <div className="text-sm text-gray-600">{item.address}</div>
                )}
              </div>

              {item.evacuation_date && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    תאריך כניסה
                  </div>
                  <div className="text-lg font-medium text-gray-900">{formatDate(item.evacuation_date)}</div>
                </div>
              )}
            </div>

            {/* Amenities */}
            {item.amenities && Object.entries(item.amenities).filter(([_, v]) => v).length > 0 && (
              <div className="mt-8 space-y-4">
                <h4 className="text-lg font-medium text-gray-900">מאפיינים</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(item.amenities).filter(([_, v]) => v).map(([key]) => {
                    const amenityNames: Record<string, string> = {
                      elevator: 'מעלית',
                      parking: 'חניה',
                      balcony: 'מרפסת',
                      airConditioner: 'מזגן',
                      storage: 'מחסן',
                      mamad: 'ממ״ד'
                    };
                    return (
                      <div key={key} className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 text-blue-800">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-sm font-medium">{amenityNames[key] || key}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {(item.description || item.full_text) && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold mb-6 text-gray-900">תיאור הנכס</h3>
              <div className="prose prose-lg max-w-none text-gray-700 leading-relaxed">
                {item.description || item.full_text}
              </div>
            </div>
          )}

          {/* Timeline */}
          {item.timeline && item.timeline.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold mb-6 text-gray-900">היסטורית עדכונים</h3>
              <div className="space-y-4">
                {item.timeline.map((event, index) => (
                  <div key={index} className="flex gap-4 p-4 rounded-lg bg-gray-50">
                    <div className="flex-shrink-0 w-3 h-3 rounded-full bg-brand-primary mt-2"></div>
                    <div className="flex-1 space-y-1">
                      <div className="text-sm font-semibold text-brand-primary">{event.type}</div>
                      <div className="text-gray-700">{event.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Contact Info */}
          {(item.contact_name || item.contact_phone) && (
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
                <Phone className="h-5 w-5 text-brand-primary" />
                פרטי קשר
              </h3>
              <div className="space-y-4">
                {item.contact_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500">שם:</span>
                    <span className="text-gray-900 font-medium">{item.contact_name}</span>
                  </div>
                )}
                {item.contact_phone && (
                  <a 
                    href={`tel:${item.contact_phone}`} 
                    className="flex items-center justify-center gap-2 w-full bg-brand-primary text-white px-4 py-3 rounded-lg font-medium hover:bg-brand-primary/90 transition-colors"
                  >
                    <Phone className="h-4 w-4" />
                    {item.contact_phone}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Meta Information */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">מידע נוסף</h3>
            <div className="space-y-3">
              {item.source && (
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">מקור:</span>
                  <span className="text-gray-900 font-medium">{item.source}</span>
                </div>
              )}
              
              {item.last_updated_external && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">עודכן:</span>
                  <span className="text-gray-900">{item.last_updated_external}</span>
                </div>
              )}
              
              {item.scraped_metadata?.scrapedAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-500">נסרק:</span>
                  <span className="text-gray-900">{new Date(item.scraped_metadata.scrapedAt).toLocaleDateString('he-IL')}</span>
                </div>
              )}
              
              {item.link && (
                <div className="pt-2">
                  <a 
                    className="text-brand-primary hover:text-brand-primary/80 flex items-center gap-1 text-sm font-medium" 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    צפה במודעה המקורית
                    <ChevronLeft className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
