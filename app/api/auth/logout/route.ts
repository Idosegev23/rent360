import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  cookies().delete('sb-access-token')
  cookies().delete('supabase-auth-token')
  return NextResponse.json({ ok: true })
}
