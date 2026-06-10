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

  async function onGoogle(){
    setError(null)
    try{
      const sb = supabaseBrowser()
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${location.origin}/auth/callback`,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      })
      if(error) throw error
    }catch(err:any){ setError(err.message) }
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 py-10">
      <h1 className="text-center text-2xl font-bold">התחברות</h1>
      <button onClick={onGoogle} type="button" className="flex w-full items-center justify-center gap-2 rounded-md border border-brand-border bg-white px-4 py-2 font-medium hover:bg-gray-50">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
        התחבר עם Google
      </button>
      <div className="text-center text-xs text-gray-400">או</div>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="w-full rounded-md border border-brand-border p-2" placeholder="אימייל" value={email} onChange={e=>setEmail(e.target.value)} />
        <input type="password" className="w-full rounded-md border border-brand-border p-2" placeholder="סיסמה" value={password} onChange={e=>setPassword(e.target.value)} />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button disabled={loading} className="w-full rounded-md bg-brand-primary px-4 py-2 font-medium text-white disabled:opacity-50">כניסה</button>
      </form>
    </main>
  )
}
