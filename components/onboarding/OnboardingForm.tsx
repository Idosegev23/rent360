'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

export type OnboardingField = {
  name: string
  label: string
  type?: 'text' | 'tel' | 'number'
  required?: boolean
  placeholder?: string
  inputMode?: 'text' | 'tel' | 'numeric'
}

/**
 * Shared public onboarding form (renter/landlord). Posts to /api/v1/public/onboarding with the
 * audience + field values + a honeypot ("company"). Branded, RTL, mobile-first. Shows a success card.
 */
export function OnboardingForm(props: {
  audience: 'renter' | 'landlord'
  title: string
  subtitle: string
  fields: OnboardingField[]
  submitLabel: string
  successTitle: string
  successBody: string
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [hp, setHp] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  function set(name: string, v: string) { setValues(prev => ({ ...prev, [name]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    for (const f of props.fields) {
      if (f.required && !String(values[f.name] || '').trim()) { setErr(`נא למלא: ${f.label}`); return }
    }
    setStatus('submitting'); setErr(null)
    try {
      const res = await fetch('/api/v1/public/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: props.audience, ...values, company: hp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.code === 'RATE_LIMITED'
          ? 'כבר קיבלנו את הפנייה. נחזור אליכם בקרוב.'
          : (data?.error?.message || 'שליחה נכשלה, נסו שוב'))
      }
      setStatus('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שליחה נכשלה')
      setStatus('error')
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-gradient-to-b from-brand-primary/5 to-white px-5 py-10 flex flex-col items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/join" className="text-gray-400 hover:text-gray-600" aria-label="חזרה"><ArrowRight className="h-5 w-5" /></Link>
          <div className="text-lg font-extrabold text-brand-primary">רנט 360</div>
          <span className="w-5" />
        </div>

        {status === 'done' ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-3 text-xl font-bold text-gray-800">{props.successTitle}</h1>
            <p className="mt-2 text-gray-500">{props.successBody}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold text-gray-800">{props.title}</h1>
            <p className="mt-1 mb-5 text-sm text-gray-500">{props.subtitle}</p>

            <div className="space-y-3">
              {props.fields.map(f => (
                <label key={f.name} className="block">
                  <span className="mb-1 block text-sm text-gray-600">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
                  <input
                    type={f.type || 'text'}
                    inputMode={f.inputMode}
                    value={values[f.name] || ''}
                    onChange={e => set(f.name, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-[16px] focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
                  />
                </label>
              ))}
            </div>

            {/* Honeypot — hidden from humans, bots fill it. */}
            <input
              type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={e => setHp(e.target.value)}
              name="company" aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0" style={{ position: 'absolute', left: '-9999px' }}
            />

            {err && <div className="mt-3 flex items-center gap-1.5 text-sm text-rose-600"><AlertCircle className="h-4 w-4" /> {err}</div>}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-3 font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {status === 'submitting' ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              {props.submitLabel}
            </button>
            <p className="mt-3 text-center text-xs text-gray-400">ניצור אתכם קשר בוואטסאפ. לא נשתף את הפרטים עם אף אחד.</p>
          </form>
        )}
      </div>
    </main>
  )
}
