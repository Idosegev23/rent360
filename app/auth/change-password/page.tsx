'use client'
import { useState } from 'react'
import { supabaseBrowser } from '../../../lib/supabase'

export default function ChangePasswordPage(){
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string|null>(null)
  const [err, setErr] = useState<string|null>(null)

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    setErr(null)
    try{
      const sb = supabaseBrowser()
      const { error } = await sb.auth.updateUser({ password })
      if(error) throw error
      setMsg('הסיסמה עודכנה')
    }catch(e:any){ setErr(e.message) }
    finally{ setLoading(false) }
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 py-10">
      <h1 className="text-center text-2xl font-bold">שינוי סיסמה</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="password" className="w-full rounded-md border border-brand-border p-2" placeholder="סיסמה חדשה" value={password} onChange={e=>setPassword(e.target.value)} />
        {err && <div className="text-sm text-red-600">{err}</div>}
        {msg && <div className="text-sm text-green-600">{msg}</div>}
        <button disabled={loading} className="w-full rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">עדכון</button>
      </form>
    </main>
  )
}
