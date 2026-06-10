import { google, type Auth } from 'googleapis'
import crypto from 'crypto'
import { googleOAuthConfig, GOOGLE_SCOPES } from '@/lib/google/config'

export function oauthClient() {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function stateSecret(): string {
  return process.env.GOOGLE_TOKEN_ENC_KEY || process.env.SUPABASE_SERVICE_ROLE || 'dev-state-secret'
}

export type OAuthState = { uid: string; orgId: string; nonce: string }

export function signState(payload: OAuthState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string): OAuthState | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState
  } catch {
    return null
  }
}

export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-consent
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  })
}

export async function exchangeCode(code: string): Promise<Auth.Credentials> {
  const { tokens } = await oauthClient().getToken(code)
  return tokens // { access_token, refresh_token?, expiry_date, scope, id_token }
}
