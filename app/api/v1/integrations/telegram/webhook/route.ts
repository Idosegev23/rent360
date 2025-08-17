import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest){
  const idem = req.headers.get('idempotency-key')
  if(!idem) return NextResponse.json({ error: { code: 'NO_IDEMPOTENCY' } }, { status: 409 })
  // TODO: verify signature if needed, parse Telegram update
  const payload = await req.json()
  return NextResponse.json({ status: 'ok' }, { status: 201 })
}
