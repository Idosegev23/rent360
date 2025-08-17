'use client';

import { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Home, 
  MapPin, 
  DollarSign,
  Grid3X3,
  List,
  TrendingUp,
  Building,
  Star,
  Eye,
  LayoutGrid
} from 'lucide-react';
import Link from 'next/link';
import { ExtendedProperty } from '../../types/property';
import PropertyCard from '../PropertyCard';

interface ModernPropertiesPageProps {
  properties: ExtendedProperty[];
}

export default function ModernPropertiesPage({ properties }: ModernPropertiesPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [priceFilter, setPriceFilter] = useState<string>('all');
  const [roomsFilter, setRoomsFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Get unique cities
  const uniqueCities = useMemo(() => {
    return Array.from(new Set(properties.map(p => p.city).filter(Boolean)));
  }, [properties]);

  // Filter properties
  const filteredProperties = useMemo(() => {
    return properties.filter(property => {
      const matchesSearch = property.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           property.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           property.neighborhood?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           property.address?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCity = cityFilter === 'all' || property.city === cityFilter;
      
      const matchesPrice = priceFilter === 'all' || (() => {
        const price = property.price || 0;
        switch (priceFilter) {
          case 'low': return price <= 4000;
          case 'medium': return price > 4000 && price <= 7000;
          case 'high': return price > 7000;
          default: return true;
        }
      })();

      const matchesRooms = roomsFilter === 'all' || (() => {
        const rooms = property.rooms || 0;
        switch (roomsFilter) {
          case '1-2': return rooms >= 1 && rooms <= 2;
          case '3-4': return rooms >= 3 && rooms <= 4;
          case '5+': return rooms >= 5;
          default: return true;
        }
      })();

      const matchesStatus = statusFilter === 'all' || (() => {
        switch (statusFilter) {
          case 'active': return property.is_active;
          case 'inactive': return !property.is_active;
          case 'new': return property.status === 'משופצת';
          default: return true;
        }
      })();

      return matchesSearch && matchesCity && matchesPrice && matchesRooms && matchesStatus;
    });
  }, [properties, searchTerm, cityFilter, priceFilter, roomsFilter, statusFilter]);

  // Calculate stats
  const totalProperties = properties.length;
  const activeProperties = properties.filter(p => p.is_active).length;
  const avgPrice = properties.length > 0 
    ? Math.round(properties.reduce((sum, p) => sum + (p.price || 0), 0) / properties.length)
    : 0;
  const avgSize = properties.length > 0 
    ? Math.round(properties.reduce((sum, p) => sum + (p.sqm || 0), 0) / properties.length)
    : 0;

  return (
    <main className="pb-20 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">נכסים</h1>
          <p className="text-gray-600 mt-1">ניהול וצפייה בנכסי השכירות</p>
        </div>
        <Link 
          href="/properties/new"
          className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-primaryMuted transition-colors"
        >
          <Plus className="h-5 w-5" />
          נכס חדש
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-brand-bg to-orange-50 rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primary text-white rounded-lg">
              <Home className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">סך הכל נכסים</p>
              <p className="text-2xl font-bold text-brand-accent">{totalProperties}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-brand-bg rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-success text-white rounded-lg">
              <Building className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">נכסים פעילים</p>
              <p className="text-2xl font-bold text-brand-accent">{activeProperties}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-brand-bg to-yellow-50 rounded-xl p-6 border border-brand-border">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-warning text-white rounded-lg">
              <DollarSign className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-inkMuted">מחיר ממוצע</p>
              <p className="text-2xl font-bold text-brand-accent">₪{avgPrice.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-brand-primaryMuted text-white rounded-lg">
              <Grid3X3 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-brand-primaryMuted">שטח ממוצע</p>
              <p className="text-2xl font-bold text-brand-accent">{avgSize} מ״ר</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-col space-y-4">
          {/* Top Row - Search and View Mode */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="חיפוש לפי כותרת, עיר, שכונה או כתובת..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
            
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                רשת
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <List className="h-4 w-4" />
                רשימה
              </button>
            </div>
          </div>

          {/* Bottom Row - Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל הערים</option>
              {uniqueCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>

            <select
              value={priceFilter}
              onChange={(e) => setPriceFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל המחירים</option>
              <option value="low">עד ₪4,000</option>
              <option value="medium">₪4,000-₪7,000</option>
              <option value="high">מעל ₪7,000</option>
            </select>

            <select
              value={roomsFilter}
              onChange={(e) => setRoomsFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל מספרי החדרים</option>
              <option value="1-2">1-2 חדרים</option>
              <option value="3-4">3-4 חדרים</option>
              <option value="5+">5+ חדרים</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">כל הסטטוסים</option>
              <option value="active">פעיל</option>
              <option value="inactive">לא פעיל</option>
              <option value="new">משופץ</option>
            </select>

            {(searchTerm || cityFilter !== 'all' || priceFilter !== 'all' || roomsFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setCityFilter('all');
                  setPriceFilter('all');
                  setRoomsFilter('all');
                  setStatusFilter('all');
                }}
                className="px-4 py-3 text-brand-primary border border-brand-primary rounded-lg hover:bg-brand-primary hover:text-white transition-colors"
              >
                נקה פילטרים
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>מציג {filteredProperties.length} מתוך {totalProperties} נכסים</span>
          </div>
        </div>
      </div>

      {/* Properties Grid/List */}
      {filteredProperties.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Home className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {totalProperties === 0 ? 'אין נכסים במערכת' : 'לא נמצאו נכסים'}
          </h3>
          <p className="text-gray-600 mb-6">
            {totalProperties === 0 
              ? 'התחל על ידי הוספת הנכס הראשון שלך'
              : 'נסה לשנות את הפילטרים או החיפוש'
            }
          </p>
          {totalProperties === 0 && (
            <Link 
              href="/properties/new"
              className="inline-flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-primaryMuted transition-colors"
            >
              <Plus className="h-5 w-5" />
              צור נכס ראשון
            </Link>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredProperties.map((property) => (
            <Link key={property.id} href={`/properties/${property.id}`}>
              <PropertyCard item={property} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">נכס</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">מיקום</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">מחיר</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">חדרים</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">שטח</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">סטטוס</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProperties.map((property) => (
                  <tr key={property.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link href={`/properties/${property.id}`} className="text-brand-primary hover:text-brand-primaryMuted font-medium">
                        {property.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {property.city}{property.neighborhood && ` · ${property.neighborhood}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ₪{(property.price || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {property.rooms || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {property.sqm ? `${property.sqm} מ״ר` : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        property.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {property.is_active ? 'פעיל' : 'לא פעיל'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}