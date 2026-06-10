'use client'
import { useEffect, useState } from 'react'

const ERRORS: Record<string, string> = {
  not_authorized: 'החשבון הזה לא רשום כאיש צוות. פנה למנהל המערכת.',
  nonce_mismatch: 'תוקף ההתחברות פג. נסה שוב.',
  bad_state: 'תקלה זמנית בהתחברות. נסה שוב.',
  exchange_failed: 'ההתחברות מול Google נכשלה. נסה שוב.',
  no_email: 'לא הצלחנו לקרוא את כתובת המייל מ-Google.',
  google_not_configured: 'חיבור Google לא מוגדר בשרת.',
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (code) setError(ERRORS[code] || 'ההתחברות נכשלה. נסה שוב.')
  }, [])

  return (
    <main className="mx-auto max-w-sm space-y-6 py-16" dir="rtl">
      <h1 className="text-center text-2xl font-bold">התחברות</h1>
      <p className="text-center text-sm text-gray-500">התחברות לצוות rent360 דרך חשבון Google.</p>
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">{error}</div>}
      <a
        href="/api/google/login"
        className="flex w-full items-center justify-center gap-2 rounded-md border border-brand-border bg-white px-4 py-3 font-medium hover:bg-gray-50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" />
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
        </svg>
        התחבר עם Google
      </a>
    </main>
  )
}
