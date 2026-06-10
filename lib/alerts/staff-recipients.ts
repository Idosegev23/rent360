import { supabaseService } from '../supabase'
import { parsePhoneList } from '../outreach/phone'

/**
 * Resolve WhatsApp alert recipients: prefer real staff `users` (active + receives_alerts + phone);
 * fall back to the legacy `ADMIN_ALERT_PHONES` env when no staff have opted in yet. This lets the
 * env→users migration happen with zero behavior change — alerts route by DB once staff are seeded.
 */
export async function staffAlertPhones(orgId?: string): Promise<string[]> {
  const sb = supabaseService()
  let resolvedOrg = orgId
  if (!resolvedOrg) {
    const { data: org } = await sb.from('organizations').select('id').order('created_at').limit(1).maybeSingle()
    resolvedOrg = org?.id
  }
  if (resolvedOrg) {
    const { data } = await sb
      .from('users')
      .select('phone')
      .eq('org_id', resolvedOrg)
      .eq('is_active', true)
      .eq('receives_alerts', true)
      .not('phone', 'is', null)
    const dbPhones = parsePhoneList((data || []).map(u => u.phone).filter(Boolean).join(','))
    if (dbPhones.length) return dbPhones
  }
  return parsePhoneList(process.env.ADMIN_ALERT_PHONES)
}
