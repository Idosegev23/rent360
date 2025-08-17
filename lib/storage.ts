import { supabaseBrowser, supabaseService } from './supabase'

export async function ensurePropertyImagesBucket(){
  const sb = supabaseService()
  const { error } = await (sb.storage as any).createBucket('property-images', { public: true })
  if (error && !String(error.message||'').toLowerCase().includes('exists')) throw error
}

export async function uploadPropertyImage(propertyId: string, file: File){
  const sb = supabaseBrowser()
  const path = `${propertyId}/${Date.now()}_${file.name}`
  const { data, error } = await sb.storage.from('property-images').upload(path, file, { upsert: false })
  if(error) throw error
  const { data: pub } = sb.storage.from('property-images').getPublicUrl(path)
  return { path, publicUrl: (pub as any).publicUrl as string }
}
