import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrg } from '../../../../../lib/outreach/admin-context'
import { dispatchRenewalOutreach } from '../../../../../lib/outreach/renewal-dispatcher'
import { RENEWAL_STATUS_FOR_CODE } from '../../../../../lib/outreach/renewal-shared'

/**
 * Single manual override send for one `renewal_leads` row — cap-free, matching
 * `outreach/send-initial/route.ts`. The batch path (`send-batch`) is what enforces the daily cap.
 *
 * Body: `{ leadId: string }`.
 * Response: the `RenewalDispatchResult` unchanged (not reshaped into `{ error: {...} }` the way
 * `send-initial` does) — Task 9 reads `result.ok`/`result.code`/`result.message` directly.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAdminOrg()
  if (!ctx) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 })
  const { orgId } = ctx

  let body: { leadId?: unknown; force?: unknown } = {}
  try {
    body = await req.json()
  } catch {/* allow empty body */}

  if (typeof body.leadId !== 'string' || !body.leadId) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'leadId required' } }, { status: 400 })
  }

  const result = await dispatchRenewalOutreach({
    orgId,
    leadId: body.leadId,
    force: body.force === true,
  })

  const status = result.ok ? 200 : (RENEWAL_STATUS_FOR_CODE[result.code] ?? 500)
  return NextResponse.json(result, { status })
}
