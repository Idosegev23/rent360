/**
 * Meta WhatsApp template creation (admin / one-off). The rest of the app only READS template
 * status (`template-sync.ts`) and SENDS approved templates (`meta-provider.ts`); this is the one
 * place that CREATES a template at Meta via the Graph API. Kept separate so the send path never
 * imports write-scoped logic.
 *
 * Docs: POST /{whatsapp_business_account_id}/message_templates
 */
const META_API = 'https://graph.facebook.com/v23.0'

export type TemplateCreateComponent = Record<string, unknown>

export type CreateTemplateResult = { id: string; status: string; category?: string }

/**
 * Submit a template for review. Returns Meta's `{ id, status }` (status is typically PENDING).
 * Throws on missing creds or a non-2xx response (with Meta's error body) so callers surface it.
 */
export async function createMessageTemplate(input: {
  name: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  language?: string
  components: TemplateCreateComponent[]
}): Promise<CreateTemplateResult> {
  const waba = process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN
  const missing: string[] = []
  if (!waba) missing.push('META_WHATSAPP_BUSINESS_ACCOUNT_ID')
  if (!token) missing.push('META_WHATSAPP_ACCESS_TOKEN')
  if (missing.length) throw new Error(`Meta template create: env not configured (missing ${missing.join(', ')})`)

  const res = await fetch(`${META_API}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      category: input.category,
      language: input.language || 'he',
      components: input.components,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { id?: string; status?: string; category?: string; error?: unknown }
  if (!res.ok || !json.id) {
    throw new Error(`Meta template create failed (${res.status}): ${JSON.stringify(json.error ?? json)}`)
  }
  const result: CreateTemplateResult = { id: json.id, status: json.status || 'PENDING' }
  if (json.category) result.category = json.category
  return result
}
