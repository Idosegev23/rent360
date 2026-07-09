'use client'

import { useState } from 'react'
import { uploadPropertyImage } from '../../lib/storage'
import { Star, X, Upload, Loader2, ImagePlus } from 'lucide-react'

/**
 * Manage a property's photos: remove (unlink), set-cover (move to front), and upload more.
 * The team uses this to swap out scraped/watermarked images for better ones the landlord sent.
 * Persistence goes through the org-checked PATCH /api/v1/properties/[id] { images } (full replace).
 */
export default function ManagePropertyImages({
  propertyId,
  images,
  onChanged,
}: {
  propertyId: string
  images: string[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function persist(next: string[]) {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'שמירה נכשלה')
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const urls: string[] = []
      for (const f of Array.from(files)) {
        const { publicUrl } = await uploadPropertyImage(propertyId, f)
        urls.push(publicUrl)
      }
      await persist([...images, ...urls])
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : 'העלאה נכשלה')
      setBusy(false)
    } finally {
      e.target.value = ''
    }
  }

  function remove(i: number) {
    if (!window.confirm('להסיר את התמונה מהנכס?')) return
    persist(images.filter((_, idx) => idx !== i))
  }

  function setCover(i: number) {
    const chosen = images[i]
    if (i === 0 || !chosen) return
    persist([chosen, ...images.filter((_, idx) => idx !== i)])
  }

  return (
    <div className="surface-card p-4" dir="rtl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-bold text-gray-800"
      >
        <span className="inline-flex items-center gap-2">
          <ImagePlus className="h-4 w-4" /> ניהול תמונות ({images.length})
        </span>
        <span className="text-xs text-brand-primary">{open ? 'סגור' : 'פתח'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {err && <div className="text-sm text-red-600">{err}</div>}

          {images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {images.map((img, i) => (
                <div key={img + i} className="relative aspect-square overflow-hidden rounded-lg border border-gray-200">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute bottom-1 right-1 rounded bg-brand-primary/90 px-1.5 py-0.5 text-[10px] text-white">
                      ראשי
                    </span>
                  )}
                  <div className="absolute inset-x-1 top-1 flex justify-between">
                    <button
                      onClick={() => setCover(i)}
                      disabled={busy || i === 0}
                      title="הפוך לתמונה ראשית"
                      className="rounded bg-black/55 p-1 text-white hover:bg-black/75 disabled:opacity-40"
                    >
                      <Star className="h-3.5 w-3.5" fill={i === 0 ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => remove(i)}
                      disabled={busy}
                      title="הסר תמונה"
                      className="rounded bg-black/55 p-1 text-white hover:bg-red-600 disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
              אין תמונות לנכס.
            </div>
          )}

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            הוסף תמונות
            <input type="file" multiple accept="image/*" onChange={onUpload} disabled={busy} className="hidden" />
          </label>
          <p className="text-xs text-gray-400">
            כוכב = הפוך לתמונה ראשית · X = הסר. הסרה מנתקת את התמונה מהנכס (הקובץ עצמו נשמר באחסון).
          </p>
        </div>
      )}
    </div>
  )
}
