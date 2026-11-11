import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { capabilitiesFor, type Capability, type PermissionOverrides } from '../auth/permissions'
import { getUserIdFromSupabaseCookie } from '../auth'
import { supabaseService } from '../supabase'

/**
 * Shared session→org resolver for UI-facing API handlers. Replaces the ~28 duplicated
 * cookie→uid→users.org_id blocks. Returns null when there's no valid session/user (handler
 * should then return 401). This does NOT enforce roles: handlers that only some roles may call
 * use requireCapability() below.
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

/**
 * Effective capabilities of the caller (role defaults + `users.permissions` overrides).
 * The overrides column comes from migration 0043; if it isn't there yet the query errors and we
 * fall back to the role defaults, so a missing migration can never lock staff out.
 */
export async function capabilitiesOf(ctx: OrgContext): Promise<Capability[]> {
  const { data, error } = await ctx.sb.from('users').select('permissions').eq('id', ctx.uid).maybeSingle()
  return capabilitiesFor(ctx.role, error ? null : (data?.permissions as PermissionOverrides))
}

/**
 * requireOrg + a capability check, for handlers that only some roles may call.
 * 401 when there is no session, 403 when the role lacks `cap`.
 */
export async function requireCapability(cap: Capability): Promise<{ ctx: OrgContext } | { res: NextResponse }> {
  const ctx = await requireOrg()
  if (!ctx) return { res: NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 }) }
  if (!(await capabilitiesOf(ctx)).includes(cap)) {
    return { res: NextResponse.json({ error: { code: 'FORBIDDEN', message: 'אין הרשאה לפעולה הזו' } }, { status: 403 }) }
  }
  return { ctx }
}
