'use client'

import { useEffect, useState } from 'react'
import { StickyNote, Plus, Loader2, X } from 'lucide-react'

type Note = { id: string; kind: string; body: string | null; author_name: string | null; created_at: string }

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Always-visible notes banner for an entity (property / thread / renter / tenancy).
 * Surfaces team notes at the TOP of the view instead of hiding them behind a tab.
 * Reuses the generic /api/v1/activity store (kind='note').
 */
export default function NotesBanner({
  entityType,
  entityId,
  className = '',
}: {
  entityType: 'property' | 'thread' | 'renter' | 'tenancy' | 'contact'
  entityId: string
  className?: string
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/v1/activity?entity_type=${entityType}&entity_id=${entityId}`)
      const d = await r.json().catch(() => ({ activity: [] }))
      setNotes((d.activity || []).filter((a: Note) => a.kind === 'note'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  async function add() {
    if (!body.trim() || busy) return
    setBusy(true)
    const r = await fetch('/api/v1/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, kind: 'note', body: body.trim() }),
    })
    setBusy(false)
    if (r.ok) {
      setBody('')
      setAdding(false)
      load()
    }
  }

  if (loading) return null

  const hasNotes = notes.length > 0

  return (
    <div
      dir="rtl"
      className={`rounded-xl border p-3 ${hasNotes ? 'border-amber-300 bg-amber-50' : 'border-dashed border-gray-300 bg-gray-50'} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
          <StickyNote className="h-4 w-4" />
          הערות
          {hasNotes && <span className="rounded-full bg-amber-200 px-1.5 text-xs text-amber-900">{notes.length}</span>}
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> הוסף הערה
          </button>
        )}
      </div>

      {hasNotes && (
        <div className="mt-2 space-y-1.5">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-white/70 px-3 py-2 text-sm text-amber-950">
              <div className="whitespace-pre-wrap">{n.body}</div>
              <div className="mt-0.5 text-[11px] text-amber-700/80">
                {n.author_name || 'מערכת'} · {fmt(n.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="כתוב הערה שתקפוץ לעיניים…"
            className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={add}
            disabled={!body.trim() || busy}
            className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שמור'}
          </button>
          <button
            onClick={() => {
              setAdding(false)
              setBody('')
            }}
            className="rounded-md p-2 text-amber-700 hover:bg-amber-100"
            aria-label="ביטול"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!hasNotes && !adding && (
        <div className="mt-1 text-xs text-gray-500">אין הערות עדיין — הוסף הערה שתופיע בראש הכרטיס.</div>
      )}
    </div>
  )
}
