export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
]

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing')
  const base = (process.env.APP_BASE_URL || 'https://rent360-vert.vercel.app').replace(/\/$/, '')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${base}/api/google/callback`
  return { clientId, clientSecret, redirectUri }
}

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
