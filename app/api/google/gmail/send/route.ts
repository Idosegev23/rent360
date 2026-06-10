import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOrg } from '@/lib/api/org-context'
import { sendGmail } from '@/lib/google/gmail'
import { GoogleNotConnectedError } from '@/lib/google/client'

const Body = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const ctx = await requireOrg()
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    const res = await sendGmail({
      orgId: ctx.orgId,
      userId: ctx.uid,
      to: parsed.data.to,
      subject: parsed.data.subject,
      text: parsed.data.text,
      ...(parsed.data.html ? { html: parsed.data.html } : {}),
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: 'google_not_connected', message: 'חבר חשבון Google קודם' }, { status: 428 })
    }
    return NextResponse.json({ error: 'gmail_failed' }, { status: 500 })
  }
}
