import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { google } from 'googleapis'
import { verifyState, exchangeCode, oauthClient } from '@/lib/google/oauth'
import { upsertConnection } from '@/lib/google/connections'
import { supabaseService } from '@/lib/supabase'
import { mintSessionToken, SECURE_COOKIES } from '@/lib/auth-session'

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const parsed = state ? verifyState(state) : null
  const isLogin = parsed?.purpose === 'login'
  // login failures go back to /auth/login; connect failures to /admin
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(isLogin ? `/auth/login?error=${reason}` : `/admin?google=error&reason=${reason}`, base))

  if (!code || !parsed) return fail('bad_state')
  const nonce = cookies().get('g_oauth_nonce')?.value
  if (!nonce || nonce !== parsed.nonce) return fail('nonce_mismatch')

  try {
    const tokens = await exchangeCode(code)
    const client = oauthClient()
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const me = await oauth2.userinfo.get()
    const email = me.data.email || null

    // Resolve the acting user: from state (connect) or by Google email (login).
    let uid = parsed.uid || null
    let orgId = parsed.orgId || null
    if (isLogin) {
      if (!email) return fail('no_email')
      const sb = supabaseService()
      const { data: user } = await sb
        .from('users')
        .select('id, org_id, is_active')
        .ilike('email', email)
        .maybeSingle()
      if (!user || user.is_active === false) return fail('not_authorized')
      uid = user.id
      orgId = user.org_id
    }
    if (!uid || !orgId) return fail('no_user')

    // Store the Google connection (Calendar/Gmail) for this user — login also connects.
    await upsertConnection({
      orgId,
      userId: uid,
      googleEmail: email,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      scopes: tokens.scope ? tokens.scope.split(' ') : null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    })

    cookies().delete('g_oauth_nonce')

    if (isLogin) {
      const { token, maxAge } = mintSessionToken({ sub: uid, email, org_id: orgId })
      cookies().set('sb-access-token', token, {
        httpOnly: true,
        secure: SECURE_COOKIES,
        sameSite: 'lax',
        maxAge,
        path: '/',
      })
      return NextResponse.redirect(new URL('/dashboard', base))
    }
    return NextResponse.redirect(new URL('/admin?google=connected', base))
  } catch {
    return fail('exchange_failed')
  }
}
