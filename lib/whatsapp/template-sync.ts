import { supabaseService } from '../supabase'

const META_API = 'https://graph.facebook.com/v23.0'

/** Map Meta's template status to our gating value. Only APPROVED enables sending; everything
 *  else (PENDING/REJECTED/PAUSED/…) maps to 'pending' so we never send a non-approved template. */
function mapStatus(meta: string): 'approved' | 'pending' {
  return (meta || '').toUpperCase() === 'APPROVED' ? 'approved' : 'pending'
}

/**
 * Pull template statuses from Meta and update `whatsapp_templates.status` so approvals reflect
 * automatically (closes the "no auto-sync" gap). Best-effort — no-ops without Meta creds, never throws.
 */
export async function syncTemplateStatuses(): Promise<{ updated: number; checked: number }> {
  const waba = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN
  if (!waba || !token) return { updated: 0, checked: 0 }
  let updated = 0
  let checked = 0
  try {
    const res = await fetch(`${META_API}/${waba}/message_templates?fields=name,status&limit=250`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { updated: 0, checked: 0 }
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string }> }
    const sb = supabaseService()
    for (const t of json.data || []) {
      if (!t?.name) continue
      checked++
      const mapped = mapStatus(t.status)
      const { data: row } = await sb.from('whatsapp_templates').select('id, status').eq('name', t.name).maybeSingle()
      if (row && row.status !== mapped) {
        await sb.from('whatsapp_templates').update({ status: mapped }).eq('id', row.id)
        updated++
      }
    }
  } catch {
    /* best-effort */
  }
  return { updated, checked }
}
