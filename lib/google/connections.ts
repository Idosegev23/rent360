import { supabaseService } from '@/lib/supabase'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret-box'

export type GoogleConnection = {
  org_id: string
  user_id: string
  google_email: string | null
  access_token: string | null
  refresh_token: string | null // decrypted plaintext when returned from getConnection
  scopes: string[] | null
  token_expiry: string | null
  status: string
}

export async function getConnection(orgId: string, userId: string): Promise<GoogleConnection | null> {
  const sb = supabaseService()
  const { data } = await sb
    .from('google_connections')
    .select('org_id, user_id, google_email, access_token, refresh_token, scopes, token_expiry, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null
  return { ...data, refresh_token: data.refresh_token ? decryptSecret(data.refresh_token) : null }
}

export async function upsertConnection(args: {
  orgId: string
  userId: string
  googleEmail: string | null
  accessToken: string | null
  refreshToken: string | null // plaintext; null preserves existing
  scopes: string[] | null
  tokenExpiry: string | null
}): Promise<void> {
  const sb = supabaseService()
  let refreshEnc: string | null
  if (args.refreshToken) {
    refreshEnc = encryptSecret(args.refreshToken)
  } else {
    const { data } = await sb
      .from('google_connections')
      .select('refresh_token')
      .eq('org_id', args.orgId)
      .eq('user_id', args.userId)
      .maybeSingle()
    refreshEnc = data?.refresh_token ?? null
  }
  await sb.from('google_connections').upsert(
    {
      org_id: args.orgId,
      user_id: args.userId,
      google_email: args.googleEmail,
      access_token: args.accessToken,
      refresh_token: refreshEnc,
      scopes: args.scopes,
      token_expiry: args.tokenExpiry,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,user_id' },
  )
}

export async function updateAccessToken(
  orgId: string,
  userId: string,
  accessToken: string,
  tokenExpiry: string | null,
): Promise<void> {
  const sb = supabaseService()
  await sb
    .from('google_connections')
    .update({ access_token: accessToken, token_expiry: tokenExpiry, status: 'active' })
    .eq('org_id', orgId)
    .eq('user_id', userId)
}

export async function markInvalid(orgId: string, userId: string): Promise<void> {
  const sb = supabaseService()
  await sb.from('google_connections').update({ status: 'invalid' }).eq('org_id', orgId).eq('user_id', userId)
}

export async function deleteConnection(orgId: string, userId: string): Promise<void> {
  const sb = supabaseService()
  await sb.from('google_connections').delete().eq('org_id', orgId).eq('user_id', userId)
}
