import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../../lib/supabase'

/**
 * Public endpoint — the renter form (/r/[token]) calls this to validate the
 * token and check if it's already been submitted. Side-effect: marks the
 * invite as 'opened' on first non-peek visit.
 *
 * Query: ?peek=1 to skip the opened-mark (used by admin polling).
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token
  if (!token || !/^[a-z0-9]{8,32}$/.test(token)) {
    return NextResponse.json({ found: false, error: 'invalid_token' }, { status: 400 })
  }

  const peek = new URL(req.url).searchParams.get('peek') === '1'
  const sb = supabaseService()

  const { data: invite } = await sb
    .from('renter_invites')
    .select('token, first_name, last_name, phone, status, submitted_at')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return NextResponse.json({ found: false })

  if (!peek && invite.status === 'pending') {
    sb.from('renter_invites')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('token', token)
      .then(() => {/* ignore */}, () => {/* ignore */})
  }

  return NextResponse.json({
    found: true,
    invite: {
      token: invite.token,
      first_name: invite.first_name || '',
      last_name: invite.last_name || '',
      phone: invite.phone || '',
      status: invite.status,
      already_submitted: !!invite.submitted_at,
    },
  })
}
