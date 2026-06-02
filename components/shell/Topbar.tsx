'use client'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, Bell } from 'lucide-react'

type Props = {
  crumb?: string
  title: string
  action?: ReactNode
  showSearch?: boolean
}

type NotifItem = {
  id: string
  type: string
  renterId: string | null
  renterName: string
  propertyId: string | null
  propertyLocation: string
  createdAt: string
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'עכשיו'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} ד׳`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} שעות`
  return `${Math.floor(h / 24)} ימים`
}

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotifItem[]>([])
  const [seenAt, setSeenAt] = useState(0)

  useEffect(() => {
    setSeenAt(Number(localStorage.getItem('notif_seen_at') || 0))
    let cancelled = false
    const load = () =>
      fetch('/api/v1/notifications')
        .then(r => r.json())
        .then(d => { if (!cancelled) setItems(d.items || []) })
        .catch(() => {})
    load()
    const iv = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const unread = items.filter(i => new Date(i.createdAt).getTime() > seenAt).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      const now = Date.now()
      localStorage.setItem('notif_seen_at', String(now))
      setSeenAt(now)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" title="התראות" aria-label="notifications" onClick={toggle}>
        <Bell size={16} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, insetInlineEnd: -4, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 9999, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            className="rounded-xl border bg-white shadow-lg"
            style={{ position: 'absolute', insetInlineEnd: 0, top: 'calc(100% + 8px)', width: 320, maxHeight: 420, overflowY: 'auto', zIndex: 50, borderColor: 'var(--line)' }}
          >
            <div className="px-4 py-2.5 border-b text-sm font-semibold" style={{ borderColor: 'var(--line)' }}>התראות</div>
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">אין התראות חדשות</div>
            ) : (
              items.map(i => (
                <Link
                  key={i.id}
                  href={i.renterId ? `/renters/${i.renterId}` : '/inbox'}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 no-underline hover:bg-gray-50 border-b"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <div className="text-sm text-gray-900">
                    <span className="font-semibold">{i.renterName}</span> מעוניין/ת לראות דירה
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">🏠 {i.propertyLocation} · {timeAgo(i.createdAt)}</div>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Topbar({ crumb, title, action, showSearch = true }: Props) {
  return (
    <header className="topbar">
      <div>
        {crumb && <div className="breadcrumb">{crumb}</div>}
        <h1>{title}</h1>
      </div>

      <div style={{ flex: 1 }} />

      {showSearch && (
        <div className="topbar-search">
          <Search size={15} />
          <input placeholder="חפש נכסים, שוכרים, שיחות…" />
          <kbd style={{ fontSize: 10, color: 'var(--ink-4)', padding: '2px 6px', border: '1px solid var(--line)', borderRadius: 4 }}>⌘K</kbd>
        </div>
      )}

      <NotificationsBell />

      {action}
    </header>
  )
}
