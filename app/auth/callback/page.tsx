'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '../../../lib/supabase'

// Login is allowlisted to these Google accounts only. (Server-side, non-roster Google users have no
// `users` row → every org-scoped API 401s, so they're locked out of data regardless; this is the UX.)
const ALLOWED = [
  'triroars@gmail.com',
  'zivatia301089@gmail.com',
  'shay20036@gmail.com',
  'info@rent360.co.il',
]

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState('מתחבר…')
  useEffect(() => {
    const sb = supabaseBrowser()
    // supabase-js processes the OAuth response in the URL on init; give it a tick, then read.
    const run = async () => {
      const { data } = await sb.auth.getSession()
      const session = data.session
      if (!session) { setMsg('ההתחברות נכשלה'); setTimeout(() => { location.href = '/auth/login' }, 1500); return }
      const email = (session.user?.email || '').toLowerCase()
      if (!ALLOWED.includes(email)) {
        await sb.auth.signOut()
        setMsg('אין הרשאה לחשבון הזה. פנה למנהל המערכת.')
        setTimeout(() => { location.href = '/auth/login?error=not_allowed' }, 2200)
        return
      }
      document.cookie = `sb-access-token=${session.access_token}; path=/; samesite=lax`
      location.href = '/dashboard'
    }
    // small delay so detectSessionInUrl finishes
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
  }, [])
  return <main className="mx-auto max-w-sm py-16 text-center text-sm text-gray-600">{msg}</main>
}
