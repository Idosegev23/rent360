import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Fallbacks to allow running without secrets set (you can override with Supabase Secrets)
const FALLBACK_EDGE_INGEST_TOKEN = 'a3f02b9c5e41d7f8c2ab6e90f1d4b3c7e9a1f2c3d4e5f6a7b8c9d0e1f2a3b4c5'
const FALLBACK_SUPABASE_URL = 'https://sjecwkuztpoqpunlpxfe.supabase.co'
const FALLBACK_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZWN3a3V6dHBvcXB1bmxweGZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDkwNjI0NiwiZXhwIjoyMDcwNDgyMjQ2fQ.3xGp774QhLvq8jHWes1svmXt1303up3MHMQcUx3Aq6A'
const FALLBACK_ORG_ID = '11111111-1111-1111-1111-111111111111'

type LeadMePayload = {
  First_name?: string
  Last_name?: string
  phone: string
  email?: string
  city_lives?: string
  rooms?: string | number
  price_range?: string
  Elevator?: string | boolean
  Mamad?: string | boolean
  balcony?: string | boolean
  AC?: string | boolean
  warehouse?: string | boolean
  type_asset?: string
  apt?: string
}

function isTruthy(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  const s = String(val || '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'כן', 'יש', 'כן.', 'true.', 'v'].includes(s)
}

function parsePriceRange(input?: string): { min?: number; max?: number } {
  if (!input) return {}
  const numbers = (input.match(/\d+/g) || []).map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n))
  if (numbers.length === 0) return {}
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] }
  const [a, b] = numbers
  const min = Math.min(a, b)
  const max = Math.max(a, b)
  return { min, max }
}

function normalizeIlPhone(raw?: string): string | undefined {
  if (!raw) return undefined
  const digits = (raw.match(/\d+/g) || []).join('')
  if (!digits) return undefined
  if (digits.startsWith('972')) {
    return `+${digits}`
  }
  if (digits.startsWith('0') && digits.length >= 9) {
    // Drop leading 0, prefix +972
    return `+972${digits.slice(1)}`
  }
  if (raw.startsWith('+')) return raw
  // Fallback: assume IL
  return `+972${digits}`
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const expectedToken = Deno.env.get('EDGE_INGEST_TOKEN') || FALLBACK_EDGE_INGEST_TOKEN
    const url = new URL(req.url)
    const tokenParam = url.searchParams.get('token') || ''
    const webhookToken = req.headers.get('x-webhook-token') || req.headers.get('X-Webhook-Token') || tokenParam
    if (!webhookToken || webhookToken !== expectedToken) {
      return new Response('Unauthorized', { status: 401 })
    }

    const ctype = req.headers.get('content-type') || ''
    let body: LeadMePayload
    if (ctype.includes('application/json')) {
      body = await req.json()
    } else if (ctype.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      const params = new URLSearchParams(text)
      body = Object.fromEntries(params.entries()) as unknown as LeadMePayload
    } else {
      // Try to parse as JSON anyway
      try {
        body = await req.json()
      } catch {
        return new Response('Unsupported Media Type', { status: 415 })
      }
    }

    if (!body?.phone) {
      return new Response(JSON.stringify({ error: 'phone is required' }), { status: 422, headers: { 'content-type': 'application/json' } })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || FALLBACK_SUPABASE_URL
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE') || FALLBACK_SERVICE_ROLE
    const orgId = Deno.env.get('ORG_ID') || FALLBACK_ORG_ID

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const sourceId = 'leadmecms'

    // Normalize keys (trim + lowercase) to tolerate field names with trailing spaces/case diffs
    const norm: Record<string, unknown> = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), v])
    )

    const firstName = (norm['first_name'] ?? norm['firstname'] ?? norm['first name'] ?? (body as any).First_name) as string | undefined
    const lastName = (norm['last_name'] ?? norm['lastname'] ?? norm['last name'] ?? (body as any).Last_name) as string | undefined
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || undefined
    const rawPhone = (norm['phone'] ?? body.phone) as string
    const phone = normalizeIlPhone(rawPhone)
    const { min: budget_min, max: budget_max } = parsePriceRange((norm['price_range'] as string | undefined) ?? body.price_range)
    const roomsRaw = (norm['rooms'] as string | number | undefined) ?? body.rooms
    const preferred_rooms = roomsRaw !== undefined && roomsRaw !== null && String(roomsRaw).trim() !== ''
      ? parseInt(String(roomsRaw), 10)
      : undefined
    const cityPref = (norm['city_lives'] as string | undefined) ?? (norm['city'] as string | undefined) ?? body.city_lives
    const preferred_cities = cityPref ? [String(cityPref).trim()] : undefined
    const nice_to_haves: Record<string, boolean | string> = {}
    const elevatorVal = (norm['elevator'] ?? (body as any).Elevator) as unknown
    const mamadVal = (norm['mamad'] ?? (body as any).Mamad) as unknown
    const balconyVal = (norm['balcony'] ?? (body as any).balcony) as unknown
    const acVal = (norm['ac'] ?? (body as any).AC) as unknown
    const warehouseVal = (norm['warehouse'] ?? (body as any).warehouse) as unknown
    const typeAssetVal = (norm['type_asset'] ?? (body as any).type_asset) as unknown
    if (elevatorVal !== undefined) nice_to_haves.elevator = isTruthy(elevatorVal)
    if (mamadVal !== undefined) nice_to_haves.mamad = isTruthy(mamadVal)
    if (balconyVal !== undefined) nice_to_haves.balcony = isTruthy(balconyVal)
    if (acVal !== undefined) nice_to_haves.ac = isTruthy(acVal)
    if (warehouseVal !== undefined) nice_to_haves.warehouse = isTruthy(warehouseVal)
    if (typeAssetVal !== undefined) nice_to_haves.type_asset = String(typeAssetVal)

    // Determine if lead exists already by (org_id, source_id, phone)
    const existing = await supabase
      .from('leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('source_id', sourceId)
      .eq('phone', phone)
      .maybeSingle()

    if (existing.error && existing.error.code !== 'PGRST116') {
      return new Response(JSON.stringify({ error: existing.error.message }), { status: 500, headers: { 'content-type': 'application/json' } })
    }

    const payload: Record<string, unknown> = {
      org_id: orgId,
      source_id: sourceId,
      full_name: fullName,
      phone,
      email: body.email || undefined,
      budget_min,
      budget_max,
      preferred_cities,
      preferred_rooms,
      nice_to_haves: Object.keys(nice_to_haves).length ? nice_to_haves : undefined,
      notes: body.apt || undefined,
    }

    let status = 201
    let leadId: string | undefined

    if (existing.data?.id) {
      const upd = await supabase
        .from('leads')
        .update(payload)
        .eq('id', existing.data.id)
        .select('id')
        .single()
      if (upd.error) {
        return new Response(JSON.stringify({ error: upd.error.message }), { status: 500, headers: { 'content-type': 'application/json' } })
      }
      status = 200
      leadId = upd.data.id
    } else {
      const ins = await supabase
        .from('leads')
        .insert(payload)
        .select('id')
        .single()
      if (ins.error) {
        // In case of race condition on unique index, fallback to select
        if (ins.error.code === '23505') {
          const again = await supabase
            .from('leads')
            .select('id')
            .eq('org_id', orgId)
            .eq('source_id', sourceId)
            .eq('phone', phone)
            .single()
          if (again.error) {
            return new Response(JSON.stringify({ error: again.error.message }), { status: 500, headers: { 'content-type': 'application/json' } })
          }
          status = 200
          leadId = again.data.id
        } else {
          return new Response(JSON.stringify({ error: ins.error.message }), { status: 500, headers: { 'content-type': 'application/json' } })
        }
      } else {
        status = 201
        leadId = ins.data.id
      }
    }

    return new Response(JSON.stringify({ lead_id: leadId, created: status === 201 }), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
})


