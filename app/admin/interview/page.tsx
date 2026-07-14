'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2, Check, AlertCircle, GripVertical } from 'lucide-react'

/**
 * Admin editor for the renter-interview topic list (the "מה-לאסוף" section of the WhatsApp intake
 * bot). Editing the title/body/order/enabled of each topic; the rest of the bot prompt is fixed in
 * code. Saves the whole list via PUT /api/v1/interview-topics.
 */
type Topic = { key: string; title: string; body_text: string; enabled: boolean }

export default function InterviewTopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/interview-topics')
      .then(r => r.json())
      .then(d => {
        setTopics((d.topics || []).map((t: any) => ({ key: t.key, title: t.title, body_text: t.body_text, enabled: t.enabled !== false })))
        setSaved(d.saved !== false)
      })
      .catch(() => setErr('טעינה נכשלה'))
      .finally(() => setLoading(false))
  }, [])

  function mutate(next: Topic[]) { setTopics(next); setDirty(true); setJustSaved(false) }
  function update(i: number, patch: Partial<Topic>) { mutate(topics.map((t, idx) => idx === i ? { ...t, ...patch } : t)) }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= topics.length) return
    const next = [...topics]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    mutate(next)
  }
  function remove(i: number) { mutate(topics.filter((_, idx) => idx !== i)) }
  function add() {
    mutate([...topics, { key: `custom_${Date.now().toString(36)}`, title: '', body_text: '', enabled: true }])
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/v1/interview-topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error?.message || 'שמירה נכשלה')
      setTopics((data.topics || []).map((t: any) => ({ key: t.key, title: t.title, body_text: t.body_text, enabled: t.enabled !== false })))
      setSaved(true); setDirty(false); setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="pb-24" dir="rtl">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600"><ArrowRight className="h-5 w-5" /></Link>
        <h1 className="text-2xl font-bold">עורך שאלון השוכר</h1>
      </div>

      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        אלה הנושאים שבוט הוואטסאפ אוסף מהשוכר בתשאול. אפשר לערוך את הכותרת והתוכן, לשנות סדר, לכבות
        נושא או להוסיף חדש. שאר אישיות הבוט והכללים קבועים בקוד. שינויים נכנסים לתוקף מיד לאחר שמירה.
        {!saved && <span className="ms-1 text-amber-600">(כרגע בשימוש ברירת-המחדל — שמירה תיצור גרסה שניתן לערוך.)</span>}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>
      ) : (
        <>
          <div className="space-y-3">
            {topics.map((t, i) => (
              <div key={t.key} className={`rounded-lg border bg-white p-3 ${t.enabled ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60'}`}>
                <div className="flex items-start gap-2">
                  <div className="flex flex-col items-center pt-1 text-gray-300">
                    <GripVertical className="h-4 w-4" />
                    <span className="text-xs font-medium text-gray-400">{i + 1}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={t.title}
                        onChange={e => update(i, { title: e.target.value })}
                        placeholder="כותרת הנושא (למשל: תקציב)"
                        className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
                        <input type="checkbox" checked={t.enabled} onChange={e => update(i, { enabled: e.target.checked })} />
                        פעיל
                      </label>
                    </div>
                    <textarea
                      value={t.body_text}
                      onChange={e => update(i, { body_text: e.target.value })}
                      placeholder="מה לשאול ואילו שדות לשמור…"
                      rows={3}
                      className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm leading-relaxed"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label="הזז למעלה"><ChevronUp className="h-4 w-4" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === topics.length - 1} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label="הזז למטה"><ChevronDown className="h-4 w-4" /></button>
                    <button type="button" onClick={() => remove(i)} className="rounded p-1 text-rose-400 hover:bg-rose-50" aria-label="מחק"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={add} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <Plus className="h-4 w-4" /> הוסף נושא
          </button>

          <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <div className="text-sm">
                {err ? <span className="inline-flex items-center gap-1 text-rose-600"><AlertCircle className="h-4 w-4" /> {err}</span>
                  : justSaved ? <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="h-4 w-4" /> נשמר</span>
                  : dirty ? <span className="text-amber-600">יש שינויים שלא נשמרו</span>
                  : <span className="text-gray-400">{topics.length} נושאים</span>}
              </div>
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} שמור
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
