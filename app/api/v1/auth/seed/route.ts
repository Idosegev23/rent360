import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '../../../../../lib/supabase'

export async function POST(req: NextRequest){
  const body = await req.json().catch(()=>({}))
  const email = (body?.email as string) || 'triroars@gmail.com'
  const password = (body?.password as string) || '123456'
  const orgId = '11111111-1111-1111-1111-111111111111'

  const sb = supabaseService()
  // Create auth user
  const { data: authUser, error: authErr } = await (sb.auth as any).admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'owner' },
    app_metadata: { org_id: orgId }
  })
  if(authErr) return NextResponse.json({ error:{ code:'CREATE_AUTH_FAILED', message: authErr.message } }, { status: 500 })

  const uid = authUser.user?.id
  if(!uid) return NextResponse.json({ error:{ code:'NO_USER' } }, { status: 500 })

  // Upsert to users table
  const { error: upErr } = await sb.from('users').upsert({
    id: uid,
    org_id: orgId,
    name: 'Owner Demo',
    email,
    phone: '+972500000001',
    role: 'owner'
  })
  if(upErr) return NextResponse.json({ error:{ code:'UPSERT_USER_FAILED', message: upErr.message } }, { status: 500 })

  return NextResponse.json({ ok:true, id: uid })
}
