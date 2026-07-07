import { cookies } from 'next/headers'
import { getUserIdFromSupabaseCookie } from '../auth'
import { supabaseService } from '../supabase'

/**
 * Shared session→org resolver for UI-facing API handlers. Replaces the ~28 duplicated
 * cookie→uid→users.org_id blocks. Returns null when there's no valid session/user (handler
 * should then return 401). All 4 staff have identical permissions — there is no role gating
 * between them, so this intentionally does NOT enforce roles.
 */
export type OrgContext = {
  sb: ReturnType<typeof supabaseService>
  orgId: string
  uid: string
  role: string | null
}

export async function requireOrg(): Promise<OrgContext | null> {
  const token = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(token)
  if (!uid) return null
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id, role, is_active').eq('id', uid).maybeSingle()
  // Deactivated staff (offboarded) are locked out here regardless of a still-valid session token —
  // requireOrg re-reads the row per request, so is_active=false takes effect on the very next call.
  if (!user || user.is_active === false) return null
  return { sb, orgId: user.org_id, uid, role: (user.role as string) ?? null }
}
