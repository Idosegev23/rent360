/**
 * Read-only health of the WhatsApp Business number at Meta: the quality rating (GREEN / YELLOW / RED)
 * and the business-initiated messaging tier (e.g. TIER_250 = 250 new conversations per 24h).
 * Used by the monthly Meta health report cron. Never sends anything.
 */

const META_API_BASE = 'https://graph.facebook.com/v23.0'

export type NumberHealth =
  | { ok: true; displayPhone: string | null; quality: string | null; tier: string | null; status: string | null }
  | { ok: false; error: string }

export async function getNumberHealth(): Promise<NumberHealth> {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN
  if (!phoneNumberId || !accessToken) return { ok: false, error: 'meta_env_missing' }

  const fields = 'display_phone_number,quality_rating,whatsapp_business_manager_messaging_limit,messaging_limit_tier,status'
  try {
    const res = await fetch(`${META_API_BASE}/${phoneNumberId}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    const j = (await res.json()) as Record<string, unknown> & { error?: { message?: string } }
    if (!res.ok) return { ok: false, error: j.error?.message || `meta_${res.status}` }
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return {
      ok: true,
      displayPhone: str(j.display_phone_number),
      quality: str(j.quality_rating),
      // The newer field is authoritative; the legacy one is a fallback for older API responses.
      tier: str(j.whatsapp_business_manager_messaging_limit) ?? str(j.messaging_limit_tier),
      status: str(j.status),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
