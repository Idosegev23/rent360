import { oauthClient } from '@/lib/google/oauth'
import { getConnection, updateAccessToken, markInvalid } from '@/lib/google/connections'

export class GoogleNotConnectedError extends Error {
  constructor(msg = 'google_not_connected') {
    super(msg)
    this.name = 'GoogleNotConnectedError'
  }
}

/** True when a Google API error means the stored grant is no longer usable. */
export function isGoogleAuthError(err: unknown): boolean {
  const e = err as { code?: number; response?: { status?: number }; message?: string }
  const status = e?.code ?? e?.response?.status
  return status === 401 || !!e?.message?.includes('invalid_grant')
}

/**
 * Build an authed OAuth2 client for a user. googleapis auto-refreshes the access token on
 * API calls; we persist the refreshed token via the 'tokens' event. Throws
 * GoogleNotConnectedError if there is no active connection with a refresh token.
 */
export async function getGoogleClientForUser(orgId: string, userId: string) {
  const conn = await getConnection(orgId, userId)
  if (!conn || conn.status !== 'active' || !conn.refresh_token) throw new GoogleNotConnectedError()
  const client = oauthClient()
  client.setCredentials({
    refresh_token: conn.refresh_token,
    ...(conn.access_token ? { access_token: conn.access_token } : {}),
    ...(conn.token_expiry ? { expiry_date: new Date(conn.token_expiry).getTime() } : {}),
  })
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      const exp = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
      void updateAccessToken(orgId, userId, tokens.access_token, exp).catch(() => {})
    }
  })
  return client
}

/** Mark a connection invalid (called by service wrappers on auth errors). */
export async function invalidateConnection(orgId: string, userId: string) {
  await markInvalid(orgId, userId)
}
