import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserIdFromSupabaseCookie } from '../../../../../lib/auth'
import { supabaseService } from '../../../../../lib/supabase'

/**
 * Mark an Action Center item "בוצע" (done) — stamps tags.action_done_at on the thread so it
 * drops off the list, until the lead has new activity (a message after the stamp) which makes
 * it resurface. Reversible: pass { undo: true } to clear the stamp.
 */
export async function POST(req: NextRequest) {
  const token = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(token)
  if (!uid) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })

  let body: { thread_id?: unknown; undo?: unknown } = {}
  try { body = await req.json() } catch {/* empty */}
  const threadId = String(body.thread_id || '')
  if (!threadId) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'thread_id required' } }, { status: 400 })

  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
  if (!user) return NextResponse.json({ error: { code: 'NO_USER' } }, { status: 401 })

  const { data: thread } = await sb.from('threads').select('id, tags').eq('id', threadId).eq('org_id', user.org_id).maybeSingle()
  if (!thread) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })

  const tags = (thread.tags && typeof thread.tags === 'object') ? { ...(thread.tags as Record<string, unknown>) } : {}
  if (body.undo === true) delete tags.action_done_at
  else tags.action_done_at = new Date().toISOString()

  const { error } = await sb.from('threads').update({ tags }).eq('id', threadId).eq('org_id', user.org_id)
  if (error) return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: error.message } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
