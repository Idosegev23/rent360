import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { google } from 'googleapis'
import { verifyState, exchangeCode, oauthClient } from '@/lib/google/oauth'
import { upsertConnection } from '@/lib/google/connections'

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app'
  const fail = (reason: string) => NextResponse.redirect(new URL(`/admin?google=error&reason=${reason}`, base))
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return fail('missing_params')
  const parsed = verifyState(state)
  if (!parsed) return fail('bad_state')
  const nonce = cookies().get('g_oauth_nonce')?.value
  if (!nonce || nonce !== parsed.nonce) return fail('nonce_mismatch')
  try {
    const tokens = await exchangeCode(code)
    const client = oauthClient()
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const me = await oauth2.userinfo.get()
    await upsertConnection({
      orgId: parsed.orgId,
      userId: parsed.uid,
      googleEmail: me.data.email || null,
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || null,
      scopes: tokens.scope ? tokens.scope.split(' ') : null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    })
    cookies().delete('g_oauth_nonce')
    return NextResponse.redirect(new URL('/admin?google=connected', base))
  } catch {
    return fail('exchange_failed')
  }
}
