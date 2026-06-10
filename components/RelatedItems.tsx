'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ListChecks, MessageCircle } from 'lucide-react'

type EntityType = 'thread' | 'property' | 'renter'
const MEETING_PARAM: Record<EntityType, string> = { thread: 'threadId', property: 'propertyId', renter: 'renterId' }

type Meeting = { id: string; title: string; starts_at: string; thread_id: string | null; property_id: string | null; owner_user_id?: string | null }
type Task = { id: string; title: string; status: string; assignee_user_id?: string | null; created_by?: string | null }
type Convo = { id: string; landlord_name?: string | null; phone?: string | null; intent?: string | null; status?: string }

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

/** The connective tissue: from any entity (conversation / property / renter) surface its linked
 *  meetings, open tasks, and (for property/renter) conversations — each a one-click jump. */
export function RelatedItems({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [convos, setConvos] = useState<Convo[]>([])
  const [team, setTeam] = useState<Record<string, string>>({})
  const nameOf = (id: string | null | undefined) => (id && team[id]) || ''

  useEffect(() => {
    fetch('/api/v1/team').then(r => r.json()).then(d => {
      const map: Record<string, string> = {}
      for (const m of (d.members || [])) map[m.id] = m.name || 'ללא שם'
      setTeam(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/v1/meetings?${MEETING_PARAM[entityType]}=${entityId}`).then(r => r.json()).then(d => setMeetings(d.meetings || [])).catch(() => {})
    fetch(`/api/v1/tasks?entity_type=${entityType}&entity_id=${entityId}`).then(r => r.json())
      .then(d => setTasks((d.tasks || []).filter((t: Task) => t.status === 'open' || t.status === 'in_progress'))).catch(() => {})
    if (entityType !== 'thread') {
      const key = entityType === 'property' ? 'propertyId' : 'renterId'
      fetch(`/api/v1/inbox/threads?${key}=${entityId}`).then(r => r.json()).then(d => setConvos(d.threads || [])).catch(() => {})
    }
  }, [entityType, entityId])

  const nothing = !meetings.length && !tasks.length && !convos.length
  const row = 'flex items-center gap-2 py-1.5 text-sm no-underline'
  const rowStyle = { borderTop: '1px solid var(--line)', color: 'var(--ink)' } as const

  return (
    <div className="surface-card" style={{ padding: 14 }}>
      <div className="faint mb-1" style={{ fontSize: 12, fontWeight: 700 }}>קשור לכרטיס הזה</div>
      {nothing && <div className="text-sm faint py-1">אין פריטים מקושרים עדיין.</div>}

      {convos.length > 0 && (
        <div className="mb-1">
          <div className="faint inline-flex items-center gap-1.5 mt-2" style={{ fontSize: 11.5 }}><MessageCircle size={12} /> שיחות</div>
          {convos.map(c => (
            <Link key={c.id} href={`/inbox/${c.id}`} className={row} style={rowStyle}>
              <span className="flex-1 truncate">{c.landlord_name || c.phone || 'שיחה'}</span>
              {c.intent && <span className="pill pill-blue" style={{ fontSize: 10 }}>{c.intent}</span>}
            </Link>
          ))}
        </div>
      )}

      {meetings.length > 0 && (
        <div className="mb-1">
          <div className="faint inline-flex items-center gap-1.5 mt-2" style={{ fontSize: 11.5 }}><CalendarDays size={12} /> פגישות</div>
          {meetings.map(m => (
            <Link key={m.id} href={m.thread_id ? `/inbox/${m.thread_id}` : (m.property_id ? `/properties/${m.property_id}` : '/meetings')} className={row} style={rowStyle}>
              <span className="flex-1 truncate">{m.title}{nameOf(m.owner_user_id) && <span className="faint"> · {nameOf(m.owner_user_id)}</span>}</span>
              <span className="num faint" style={{ fontSize: 11.5 }}>{fmt(m.starts_at)}</span>
            </Link>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <div>
          <div className="faint inline-flex items-center gap-1.5 mt-2" style={{ fontSize: 11.5 }}><ListChecks size={12} /> משימות פתוחות</div>
          {tasks.map(t => (
            <Link key={t.id} href="/tasks" className={row} style={rowStyle}>
              <span className="flex-1 truncate">{t.title}</span>
              {nameOf(t.assignee_user_id) && <span className="pill pill-gray" style={{ fontSize: 10 }}>ל-{nameOf(t.assignee_user_id)}</span>}
              {nameOf(t.created_by) && <span className="faint" style={{ fontSize: 10.5 }}>הזין {nameOf(t.created_by)}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
