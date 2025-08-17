'use client';

import { useState } from 'react';

interface PropertyImageGalleryProps {
  images: string[];
  title: string;
}

export default function PropertyImageGallery({ images, title }: PropertyImageGalleryProps) {
  const [mainImage, setMainImage] = useState(0);

  if (!images || images.length === 0) {
    return null;
  }

  const handleImageClick = (index: number) => {
    setMainImage(index);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-gray-900">גלריית תמונות ({images.length})</h2>
      
      {/* Main Image */}
      <div className="aspect-[16/10] overflow-hidden rounded-xl shadow-lg bg-gray-100">
        <img 
          src={images[mainImage]} 
          alt={`${title} - תמונה ראשית`} 
          className="h-full w-full object-cover" 
        />
      </div>

      {/* Additional Images */}
      {images.length > 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-700">תמונות נוספות</h3>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
            {images.map((img: string, i: number) => (
              <div 
                key={i} 
                className={`aspect-square overflow-hidden rounded-lg shadow-sm transition-all duration-200 cursor-pointer group ${
                  i === mainImage 
                    ? 'ring-2 ring-brand-primary shadow-md' 
                    : 'hover:shadow-md hover:ring-1 hover:ring-gray-300'
                }`}
                onClick={() => handleImageClick(i)}
              >
                <img 
                  src={img} 
                  alt={`${title} - תמונה ${i + 1}`} 
                  className={`h-full w-full object-cover transition-transform duration-200 ${
                    i === mainImage 
                      ? 'scale-100' 
                      : 'group-hover:scale-105'
                  }`} 
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 text-center">
            לחץ על תמונה כדי להציג אותה בגודל מלא
          </p>
        </div>
      )}
    </div>
  );
}