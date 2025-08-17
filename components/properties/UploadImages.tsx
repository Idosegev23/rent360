'use client'
import { useState } from 'react'
import { uploadPropertyImage } from '../../lib/storage'
import { supabaseBrowser } from '../../lib/supabase'

export default function UploadImages({ propertyId, onUploaded }: { propertyId: string; onUploaded?: () => void }){
  const [files, setFiles] = useState<FileList | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string|null>(null)

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    if(!files || files.length===0) return
    setLoading(true)
    setErr(null)
    try{
      const urls: string[] = []
      for(const f of Array.from(files)){
        const { publicUrl } = await uploadPropertyImage(propertyId, f)
        urls.push(publicUrl)
      }
      const sb = supabaseBrowser()
      // append to images array
      const { data: current } = await sb.from('properties').select('images').eq('id', propertyId).maybeSingle()
      const newImages = [ ...(current?.images || []), ...urls ]
      const { error } = await sb.from('properties').update({ images: newImages }).eq('id', propertyId)
      if(error) throw error
      onUploaded?.()
      setFiles(null)
    }catch(e:any){ setErr(e.message) }
    finally{ setLoading(false) }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="file" multiple accept="image/*" onChange={e=>setFiles(e.target.files)} />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button disabled={loading} className="rounded-md bg-brand-primary px-3 py-1 text-white disabled:opacity-50">העלה תמונות</button>
    </form>
  )
}

