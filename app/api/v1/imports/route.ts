import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest){
  const idem = req.headers.get('idempotency-key')
  const auth = req.headers.get('authorization')
  if(!idem) return NextResponse.json({ error: { code: 'NO_IDEMPOTENCY' } }, { status: 409 })
  if(!auth) return NextResponse.json({ error: { code: 'NO_AUTH' } }, { status: 401 })
  const payload = await req.json()
  // TODO: validate, batch validate/commit
  return NextResponse.json({ status: 'ok' }, { status: 201 })
}
