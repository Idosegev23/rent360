'use client'
import { useState } from 'react'
import { supabaseBrowser } from '../../../lib/supabase'

export default function LoginPage(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    setLoading(true)
    setError(null)
    try{
      const sb = supabaseBrowser()
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if(error) throw error
      // Ensure cookie exists for middleware
      // In browser, supabase-js sets cookies by default. Just in case, fall back to storing access token.
      if (data.session?.access_token) {
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; samesite=lax`
      }
      location.href = '/dashboard'
    }catch(err:any){ setError(err.message) }
    finally{ setLoading(false) }
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 py-10">
      <h1 className="text-center text-2xl font-bold">התחברות</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="w-full rounded-md border border-brand-border p-2" placeholder="אימייל" value={email} onChange={e=>setEmail(e.target.value)} />
        <input type="password" className="w-full rounded-md border border-brand-border p-2" placeholder="סיסמה" value={password} onChange={e=>setPassword(e.target.value)} />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button disabled={loading} className="w-full rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">כניסה</button>
      </form>
    </main>
  )
}
