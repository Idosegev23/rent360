import crypto from 'crypto'

/**
 * Mint an app session token shaped like the Supabase access token the rest of the app
 * already consumes (`sb-access-token` cookie → getUserIdFromSupabaseCookie reads `sub`).
 *
 * NOTE: the app reads the token by base64-decoding the payload and trusting `sub` WITHOUT
 * verifying the signature (see lib/auth.ts). We still HS256-sign here for hygiene, but the
 * security posture is intentionally the same as the existing app (per product decision).
 */
function sessionSecret(): string {
  return (
    process.env.SUPABASE_JWT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.GOOGLE_TOKEN_ENC_KEY ||
    'dev-session-secret'
  )
}

export function mintSessionToken(
  payload: { sub: string; email?: string | null; org_id?: string },
  ttlSeconds = 60 * 60 * 24 * 30,
): { token: string; maxAge: number } {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = {
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + ttlSeconds,
    sub: payload.sub,
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.org_id ? { org_id: payload.org_id } : {}),
  }
  const h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const p = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = crypto.createHmac('sha256', sessionSecret()).update(`${h}.${p}`).digest('base64url')
  return { token: `${h}.${p}.${sig}`, maxAge: ttlSeconds }
}

/** Cookies are only `secure` in production so http://localhost dev still works. */
export const SECURE_COOKIES = process.env.NODE_ENV === 'production'
