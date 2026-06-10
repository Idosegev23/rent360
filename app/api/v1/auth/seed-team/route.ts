import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'
import { normalizePhone } from '../../../../../lib/whatsapp/meta-provider'

/**
 * One-shot, idempotent: make the 4 office staff real `users` rows (Google login by email +
 * WhatsApp phone + identical 'admin' permissions). Existing rows (Ido/Ziv) are updated; missing
 * ones (Shai/Daria) get an auth user created so Google login links by email on first sign-in.
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Re-runnable.
 */
const ROSTER: Array<{ email: string; name: string; phoneLocal: string }> = [
  { email: 'triroars@gmail.com',       name: 'עידו', phoneLocal: '0547667775' },
  { email: 'zivatia301089@gmail.com',  name: 'זיו',  phoneLocal: '0545650748' },
  { email: 'shay20036@gmail.com',      name: 'שי',   phoneLocal: '0527559049' },
  { email: 'dashkin10@gmail.com',      name: 'דריה', phoneLocal: '0546842407' },
]

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  }
  const sb = supabaseService()
  const { data: org } = await sb.from('organizations').select('id').order('created_at').limit(1).maybeSingle()
  const orgId = org?.id
  if (!orgId) return NextResponse.json({ error: { code: 'NO_ORG' } }, { status: 500 })

  const results: Array<{ email: string; action: string; id?: string; error?: string }> = []
  for (const r of ROSTER) {
    const email = r.email.toLowerCase()
    const phone = normalizePhone(r.phoneLocal)
    try {
      // Existing users row (case-insensitive email)?
      const { data: existing } = await sb.from('users').select('id').ilike('email', email).maybeSingle()
      if (existing) {
        await sb.from('users').update({
          name: r.name, phone, role: 'admin', is_active: true, receives_alerts: true,
        }).eq('id', existing.id)
        results.push({ email, action: 'updated', id: existing.id })
        continue
      }
      // No row → ensure an auth user exists, then insert the users row with id = auth uid.
      let authId: string | undefined
      const created = await sb.auth.admin.createUser({
        email, email_confirm: true, app_metadata: { org_id: orgId },
      })
      if (created.data?.user?.id) {
        authId = created.data.user.id
      } else {
        // Likely "already registered" in auth but no users row — find the auth user by email.
        const list = await sb.auth.admin.listUsers()
        authId = list.data?.users?.find(u => (u.email || '').toLowerCase() === email)?.id
      }
      if (!authId) { results.push({ email, action: 'failed', error: created.error?.message || 'no auth id' }); continue }
      const { error: insErr } = await sb.from('users').insert({
        id: authId, org_id: orgId, email, name: r.name, phone, role: 'admin',
        is_active: true, receives_alerts: true,
      })
      results.push({ email, action: insErr ? 'failed' : 'created', id: authId, ...(insErr ? { error: insErr.message } : {}) })
    } catch (e) {
      results.push({ email, action: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, orgId, results })
}
