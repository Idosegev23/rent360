'use client'
import { useEffect, useState } from 'react'
import { Loader2, MessageSquarePlus, Phone, StickyNote, MessageCircle } from 'lucide-react'

type Item = {
  id: string
  kind: string
  body: string | null
  author_name: string | null
  created_at: string
}

const KIND_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  note: StickyNote,
  call: Phone,
  whatsapp: MessageCircle,
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ActivityTimeline(props: { entityType: string; entityId: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('note')
  const [busy, setBusy] = useState(false)

  async function load() {
    const r = await fetch(`/api/v1/activity?entity_type=${props.entityType}&entity_id=${props.entityId}`)
    const d = await r.json().catch(() => ({ activity: [] }))
    setItems(d.activity || [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entityId])

  async function add() {
    if (!body.trim() || busy) return
    setBusy(true)
    const r = await fetch('/api/v1/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: props.entityType, entity_id: props.entityId, kind, body: body.trim() }),
    })
    setBusy(false)
    if (r.ok) {
      setBody('')
      load()
    }
  }

  return (
    <div className="surface-card p-3" dir="rtl">
      <h3 className="mb-2 text-sm font-bold">פעילות</h3>
      <div className="mb-3 flex items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm">
          <option value="note">הערה</option>
          <option value="call">שיחת טלפון</option>
        </select>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="הוסף הערה…"
          className="flex-1 rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <button onClick={add} disabled={!body.trim() || busy} className="flex items-center gap-1 rounded-md bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-brand-primary" /></div>
      ) : items.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">אין פעילות עדיין.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const Icon = KIND_ICON[it.kind] || StickyNote
            return (
              <div key={it.id} className="flex gap-2 border-r-2 border-gray-100 pr-2 text-sm">
                <Icon size={14} className="mt-0.5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  {it.body && <div className="whitespace-pre-wrap text-gray-800">{it.body}</div>}
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    {it.author_name || 'מערכת'} · {fmt(it.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
