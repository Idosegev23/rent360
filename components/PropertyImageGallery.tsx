'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

interface PropertyImageGalleryProps {
  images: string[];
  title: string;
}

// Derive a friendly, filesystem-safe filename from the property title + index.
function safeName(title: string, i: number, url: string) {
  const ext = ((url.split('?')[0] || '').match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase();
  const base = (title || 'נכס').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 40) || 'נכס';
  return `${base}-${i + 1}.${ext}`;
}

// Save an image to the device. Works for CORS-enabled hosts (Supabase Storage). For hotlinked
// images that block cross-origin fetch (e.g. yad2), fall back to opening the image so the user
// can long-press → "שמור תמונה" on mobile.
async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export default function PropertyImageGallery({ images, title }: PropertyImageGalleryProps) {
  const [mainImage, setMainImage] = useState(0);
  const [downloadingAll, setDownloadingAll] = useState(false);

  if (!images || images.length === 0) {
    return null;
  }

  const handleImageClick = (index: number) => {
    setMainImage(index);
  };

  const downloadAll = async () => {
    setDownloadingAll(true);
    try {
      for (let i = 0; i < images.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await downloadImage(images[i]!, safeName(title, i, images[i]!));
        // Small gap so the browser doesn't drop later downloads in the batch.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-2xl font-semibold text-gray-900">גלריית תמונות ({images.length})</h2>
        {images.length > 1 && (
          <button
            onClick={downloadAll}
            disabled={downloadingAll}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloadingAll ? 'מוריד…' : 'הורד הכל למכשיר'}
          </button>
        )}
      </div>

      {/* Main Image */}
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl shadow-lg bg-gray-100">
        <img
          src={images[mainImage]}
          alt={`${title} - תמונה ראשית`}
          className="h-full w-full object-cover"
        />
        <button
          onClick={() => downloadImage(images[mainImage]!, safeName(title, mainImage, images[mainImage]!))}
          className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
          title="שמור תמונה למכשיר"
        >
          <Download className="h-4 w-4" />
          שמור תמונה
        </button>
      </div>

      {/* Additional Images */}
      {images.length > 1 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-700">תמונות נוספות</h3>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
            {images.map((img: string, i: number) => (
              <div
                key={i}
                className={`relative aspect-square overflow-hidden rounded-lg shadow-sm transition-all duration-200 cursor-pointer group ${
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
                    i === mainImage ? 'scale-100' : 'group-hover:scale-105'
                  }`}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadImage(img, safeName(title, i, img));
                  }}
                  className="absolute left-1 top-1 rounded-md bg-black/55 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100 focus:opacity-100"
                  title="שמור תמונה למכשיר"
                  aria-label="שמור תמונה למכשיר"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 text-center">
            לחץ על תמונה כדי להציג אותה בגודל מלא · לחץ על סמל ההורדה כדי לשמור למכשיר
          </p>
        </div>
      )}
    </div>
  );
}
