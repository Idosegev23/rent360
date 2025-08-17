import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest){
  const { email, password } = await req.json()
  if(!email || !password) return NextResponse.json({ error:{ code:'INVALID', message:'email/password required' } }, { status: 422 })

  const devEmail = process.env.DEV_LOGIN_EMAIL || 'triroars@gmail.com'
  const devPass = process.env.DEV_LOGIN_PASSWORD || '123456'
  if(email !== devEmail || password !== devPass){
    return NextResponse.json({ error:{ code:'BAD_CREDENTIALS' } }, { status: 401 })
  }
  const res = NextResponse.json({ ok:true })
  res.cookies.set('session', 'dev', { httpOnly:true, sameSite:'lax', path:'/' })
  return res
}
