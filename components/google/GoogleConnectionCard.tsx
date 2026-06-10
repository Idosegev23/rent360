'use client'
import { useEffect, useState } from 'react'

type Status = { connected: boolean; email: string | null; status: string | null; scopes: string[] }

export function GoogleConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const r = await fetch('/api/google/status')
    if (r.ok) setStatus(await r.json())
  }
  useEffect(() => {
    void refresh()
  }, [])

  async function disconnect() {
    setLoading(true)
    await fetch('/api/google/disconnect', { method: 'POST' }).catch(() => {})
    setLoading(false)
    void refresh()
  }

  return (
    <div className="rounded-xl border p-4" dir="rtl">
      <h3 className="font-bold mb-2">חיבור Google (יומן + אימייל)</h3>
      {status?.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-green-700">מחובר: {status.email}</p>
          <button onClick={disconnect} disabled={loading} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">
            נתק
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">חבר את חשבון ה-Google שלך כדי ליצור אירועי יומן ולשלוח מיילים בשמך.</p>
          <a href="/api/google/connect" className="inline-block px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">
            חבר חשבון Google
          </a>
        </div>
      )}
    </div>
  )
}
