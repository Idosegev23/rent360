import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { nanoid } from 'nanoid'
import { requireOrg } from '@/lib/api/org-context'
import { consentUrl, signState } from '@/lib/google/oauth'
import { isGoogleConfigured } from '@/lib/google/config'

export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'google_not_configured' }, { status: 500 })
  }
  const ctx = await requireOrg()
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  if (!ctx) return NextResponse.redirect(new URL('/auth/login', base))
  const nonce = nanoid()
  cookies().set('g_oauth_nonce', nonce, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  const state = signState({ uid: ctx.uid, orgId: ctx.orgId, nonce })
  return NextResponse.redirect(consentUrl(state))
}
