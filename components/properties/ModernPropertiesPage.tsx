'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Building2,
  Star,
  Eye,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import Link from 'next/link';
import { type ExtendedProperty } from '../../types/property';
import PropertyCard from '../PropertyCard';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface PropertiesResponse {
  properties: ExtendedProperty[];
  pagination: PaginationInfo;
}

interface ModernPropertiesPageProps {
  apiEndpoint?: string;
  pageTitle?: string;
}

interface FilterState {
  search: string;
  city: string;
  priceMin: string;
  priceMax: string;
  roomsMin: string;
  roomsMax: string;
  isActive: string;
  amenities: string[];
  isBrokerage: string;
}

export default function ModernPropertiesPage({
  apiEndpoint = '/api/v1/properties',
  pageTitle = 'נכסים'
}: ModernPropertiesPageProps) {
  const [properties, setProperties] = useState<ExtendedProperty[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    city: '',
    priceMin: '',
    priceMax: '',
    roomsMin: '',
    roomsMax: '',
    isActive: '',
    amenities: [],
    isBrokerage: ''
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [allCities, setAllCities] = useState<string[]>([]);

  // Fetch properties function
  const fetchProperties = async (page: number = 1, currentFilters: FilterState = filters) => {
    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });

      if (currentFilters.search) searchParams.set('search', currentFilters.search);
      if (currentFilters.city) searchParams.set('city', currentFilters.city);
      if (currentFilters.priceMin) searchParams.set('price_min', currentFilters.priceMin);
      if (currentFilters.priceMax) searchParams.set('price_max', currentFilters.priceMax);
      if (currentFilters.roomsMin) searchParams.set('rooms_min', currentFilters.roomsMin);
      if (currentFilters.roomsMax) searchParams.set('rooms_max', currentFilters.roomsMax);
      if (currentFilters.isActive) searchParams.set('is_active', currentFilters.isActive);
      if (currentFilters.amenities.length > 0) searchParams.set('amenities', currentFilters.amenities.join(','));
      if (currentFilters.isBrokerage) searchParams.set('is_brokerage', currentFilters.isBrokerage);

      const response = await fetch(`${apiEndpoint}?${searchParams}`);
      if (!response.ok) throw new Error('Failed to fetch properties');
      
      const data: PropertiesResponse = await response.json();
      setProperties(data.properties);
      setPagination(data.pagination);

      // Update cities list from all properties for filter dropdown
      if (page === 1) {
        const cities = Array.from(new Set(data.properties.map(p => p.city).filter(Boolean)));
        setAllCities(cities);
      }
    } catch (error) {
      console.error('Error fetching properties:', error);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchProperties(1, filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle filter changes
  const handleFilterChange = (newFilters: Partial<FilterState>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    fetchProperties(1, updatedFilters);
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    fetchProperties(newPage, filters);
  };

  // Clear all filters
  const clearFilters = () => {
    const clearedFilters: FilterState = {
      search: '',
      city: '',
      priceMin: '',
      priceMax: '',
      roomsMin: '',
      roomsMax: '',
      isActive: '',
      amenities: [],
      isBrokerage: ''
    };
    setFilters(clearedFilters);
    fetchProperties(1, clearedFilters);
  };

  // Handle amenity toggle
  const toggleAmenity = (amenity: string) => {
    const newAmenities = filters.amenities.includes(amenity)
      ? filters.amenities.filter(a => a !== amenity)
      : [...filters.amenities, amenity];
    handleFilterChange({ amenities: newAmenities });
  };

  // Calculate stats from all properties (total count from pagination)
  const totalProperties = pagination.total;
  const activeProperties = properties.filter(p => p.is_active).length; // This is for current page only
  const avgPrice = properties.length > 0 
    ? Math.round(properties.reduce((sum, p) => sum + (p.price || 0), 0) / properties.length)
    : 0;
  const avgSize = properties.length > 0 
    ? Math.round(properties.reduce((sum, p) => sum + (p.sqm || 0), 0) / properties.length)
    : 0;

  // Available amenities
  const availableAmenities = [
    { key: 'elevator', label: 'מעלית' },
    { key: 'parking', label: 'חניה' },
    { key: 'balcony', label: 'מרפסת' },
    { key: 'airConditioner', label: 'מזגן' },
    { key: 'storage', label: 'מחסן' },
    { key: 'mamad', label: 'ממ״ד' }
  ];

  return (
    <main className="pb-20 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{pageTitle}</h1>
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
                value={filters.search}
                onChange={(e) => handleFilterChange({ search: e.target.value })}
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
              value={filters.city}
              onChange={(e) => handleFilterChange({ city: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="">כל הערים</option>
              {allCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                type="number"
                placeholder="מחיר מינימום"
                value={filters.priceMin}
                onChange={(e) => handleFilterChange({ priceMin: e.target.value })}
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent w-32"
              />
              <input
                type="number"
                placeholder="מחיר מקסימום"
                value={filters.priceMax}
                onChange={(e) => handleFilterChange({ priceMax: e.target.value })}
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent w-32"
              />
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                placeholder="חדרים מינימום"
                value={filters.roomsMin}
                onChange={(e) => handleFilterChange({ roomsMin: e.target.value })}
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent w-32"
              />
              <input
                type="number"
                placeholder="חדרים מקסימום"
                value={filters.roomsMax}
                onChange={(e) => handleFilterChange({ roomsMax: e.target.value })}
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent w-32"
              />
            </div>

            <select
              value={filters.isActive}
              onChange={(e) => handleFilterChange({ isActive: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="">כל הסטטוסים</option>
              <option value="true">פעיל</option>
              <option value="false">לא פעיל</option>
            </select>

            <select
              value={filters.isBrokerage}
              onChange={(e) => handleFilterChange({ isBrokerage: e.target.value })}
              className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="">הכל</option>
              <option value="false">ישיר (ללא תיווך)</option>
              <option value="true">יד 2 תיווך</option>
            </select>

            {(filters.search || filters.city || filters.priceMin || filters.priceMax || filters.roomsMin || filters.roomsMax || filters.isActive || filters.isBrokerage || filters.amenities.length > 0) && (
              <button
                onClick={clearFilters}
                className="px-4 py-3 text-brand-primary border border-brand-primary rounded-lg hover:bg-brand-primary hover:text-white transition-colors"
              >
                נקה פילטרים
              </button>
            )}
          </div>

          {/* Amenities Filter */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-700">מאפיינים</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {availableAmenities.map((amenity) => (
                <label
                  key={amenity.key}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={filters.amenities.includes(amenity.key)}
                    onChange={() => toggleAmenity(amenity.key)}
                    className="rounded border-gray-300 text-brand-primary focus:ring-brand-primary focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-gray-700">{amenity.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>מציג {properties.length} מתוך {totalProperties} נכסים</span>
            {loading && (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>טוען...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Properties Grid/List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Loader2 className="h-16 w-16 text-gray-300 mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">טוען נכסים...</h3>
        </div>
      ) : properties.length === 0 ? (
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
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {properties.map((property) => (
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
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">מקור</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {properties.map((property) => (
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
                        <td className="px-6 py-4 whitespace-nowrap">
                          {property.source && property.source.includes('יד 2 תיווך') ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                              <Building2 className="h-3 w-3" />
                              יד 2 תיווך
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                              ישיר
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  עמוד {pagination.page} מתוך {pagination.totalPages} (סך הכל {totalProperties} נכסים)
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.hasPrev || loading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-4 w-4" />
                    הקודם
                  </button>
                  
                  {/* Page numbers */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      const pageNum = i + 1;
                      const isCurrentPage = pageNum === pagination.page;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          disabled={loading}
                          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            isCurrentPage
                              ? 'bg-brand-primary text-white'
                              : 'text-gray-700 hover:bg-gray-100 disabled:opacity-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    {pagination.totalPages > 5 && (
                      <>
                        <span className="px-2 text-gray-500">...</span>
                        <button
                          onClick={() => handlePageChange(pagination.totalPages)}
                          disabled={loading}
                          className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                        >
                          {pagination.totalPages}
                        </button>
                      </>
                    )}
                  </div>
                  
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasNext || loading}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    הבא
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}