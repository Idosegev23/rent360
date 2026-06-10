import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { nanoid } from 'nanoid'
import { consentUrl, signState } from '@/lib/google/oauth'
import { isGoogleConfigured } from '@/lib/google/config'
import { SECURE_COOKIES } from '@/lib/auth-session'

/**
 * Direct Google login (no Supabase provider). Public — there's no session yet.
 * The callback resolves the user by their Google email and mints the app session.
 */
export async function GET() {
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL('/auth/login?error=google_not_configured', base))
  }
  const nonce = nanoid()
  cookies().set('g_oauth_nonce', nonce, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'lax', maxAge: 600, path: '/' })
  return NextResponse.redirect(consentUrl(signState({ purpose: 'login', nonce })))
}
