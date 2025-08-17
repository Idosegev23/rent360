import { NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'

export async function POST(){
  const sb = supabaseService()
  try {
    // Try to create bucket; if exists, ignore
    const { error } = await (sb.storage as any).createBucket('property-images', {
      public: true,
      allowedMimeTypes: ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'],
    })
    if (error && !String(error.message || '').toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: { code: 'CREATE_BUCKET_FAILED', message: error.message } }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: { code: 'EXCEPTION', message: e?.message } }, { status: 500 })
  }
}

