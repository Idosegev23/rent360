'use client'

import { useState } from 'react'
import { MessageSquare, Loader2, Send } from 'lucide-react'

/**
 * Handoff notes for a task — the thread of notes/requests people leave when handing a task over or
 * returning it ("missing X", "please redo Y"). Backed by the activity log (entity_type='task',
 * kind='note'), so it keeps full history with author + time. Lazy-loads on expand.
 */
type Note = { id: string; body: string | null; author_name?: string | null; created_at: string; kind: string }

const fmt = (iso: string) => { try { return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function TaskNotes({ taskId, count, onChanged }: { taskId: string; count: number; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/activity?entity_type=task&entity_id=${taskId}`)
      const d = await r.json().catch(() => ({ activity: [] }))
      setNotes((d.activity || []).filter((a: Note) => a.kind === 'note'))
    } finally { setLoading(false) }
  }
  function toggle() { const n = !open; setOpen(n); if (n && notes === null) load() }

  async function add() {
    const body = draft.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      await fetch('/api/v1/activity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'task', entity_id: taskId, kind: 'note', body }),
      })
      setDraft('')
      await load()
      onChanged?.()
    } finally { setSaving(false) }
  }

  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-xs" style={{ color: count > 0 ? 'var(--brand)' : 'var(--ink-4)' }}>
        <MessageSquare className="h-3.5 w-3.5" /> {count > 0 ? `הערות (${count})` : 'הוסף הערה'}
      </button>

      {open && (
        <div className="mt-2 rounded-md border p-2" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }} onClick={e => e.stopPropagation()}>
          {loading ? (
            <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
          ) : (
            <div className="space-y-2">
              {(notes || []).length === 0 && <div className="text-xs" style={{ color: 'var(--ink-4)' }}>אין הערות עדיין.</div>}
              {(notes || []).map(n => (
                <div key={n.id} className="text-xs">
                  <div className="whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{n.body}</div>
                  <div className="mt-0.5" style={{ color: 'var(--ink-4)' }}>{[n.author_name || 'צוות', fmt(n.created_at)].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') add() }}
                  placeholder="הערה / בקשה…"
                  className="flex-1 rounded-md border border-brand-border px-2 py-1 text-xs"
                />
                <button type="button" onClick={add} disabled={!draft.trim() || saving} className="rounded-md bg-brand-primary px-2 py-1 text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
