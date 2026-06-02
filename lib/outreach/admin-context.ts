/**
 * Shared admin auth for the Outreach Control Center routes.
 *
 * Every /api/v1/outreach/* admin endpoint resolves the caller's org from the
 * Supabase session cookie (the browser/session path — see CLAUDE.md), the same
 * way the UI-facing GET routes do. Extracted here so the five new endpoints
 * don't each re-implement it.
 */

import { cookies } from 'next/headers'
import { supabaseService } from '../supabase'
import { getUserIdFromSupabaseCookie } from '../auth'

export type AdminContext = { orgId: string; userId: string }

/** Resolve the admin's org from the `sb-access-token` cookie. Returns null if unauthenticated. */
export async function requireAdminOrg(): Promise<AdminContext | null> {
  const cookie = cookies().get('sb-access-token')?.value
  const userId = getUserIdFromSupabaseCookie(cookie)
  if (!userId) return null
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', userId).maybeSingle()
  if (!user?.org_id) return null
  return { orgId: user.org_id, userId }
}
