'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Building2,
  Users,
  Inbox,
  CheckCircle2,
  Settings,
  Send,
  Target,
  Archive,
  UserCog,
  LogOut,
  CheckSquare,
  CalendarDays,
  GitBranch,
  Coins,
  BarChart3,
  ClipboardList,
  KeyRound,
  History,
  Table2,
} from 'lucide-react'

type Me = { name: string | null; email: string | null; capabilities?: string[]; google: { connected: boolean; email: string | null } }

type NavLink = {
  href: string
  label: string
  Icon: React.ComponentType<{ size?: number }>
  badge?: number | string
  /** Hidden for staff without this capability (lib/auth/permissions.ts). */
  cap?: string
}

const main: NavLink[] = [
  { href: '/dashboard',            label: 'דשבורד',         Icon: LayoutDashboard },
  { href: '/board',                label: 'לוח בקרה',        Icon: Target },
  { href: '/deals',                label: 'לוח עסקאות',      Icon: Table2 },
  { href: '/pipeline',             label: 'צינור עסקאות',    Icon: GitBranch },
  { href: '/tasks',                label: 'משימות',          Icon: CheckSquare },
  { href: '/meetings',             label: 'פגישות',          Icon: CalendarDays },
  { href: '/properties',           label: 'נכסים',           Icon: Building2 },
  { href: '/approved-properties',  label: 'מאושרים',        Icon: CheckCircle2 },
  { href: '/approved-properties/irrelevant', label: 'לא רלוונטיים', Icon: Archive },
  { href: '/rented',               label: 'הושכרו על ידינו',  Icon: KeyRound },
  { href: '/renters',              label: 'שוכרים',          Icon: Users },
  { href: '/team',                 label: 'צוות',            Icon: UserCog },
  { href: '/outreach',             label: 'שליחה',           Icon: Send, cap: 'outreach.send' },
  { href: '/outreach/renter-sends', label: 'יומן שליחות',    Icon: ClipboardList, cap: 'outreach.send' },
  { href: '/renewals',             label: 'לידי חידוש',      Icon: History, cap: 'outreach.send' },
  { href: '/inbox',                label: 'שיחות',           Icon: Inbox },
]

const secondary: NavLink[] = [
  { href: '/commissions', label: 'עמלות', Icon: Coins },
  { href: '/reports', label: 'דוחות', Icon: BarChart3, cap: 'reports.view' },
  { href: '/admin', label: 'הגדרות', Icon: Settings },
]

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/dashboard') return pathname === '/' || pathname.startsWith('/dashboard')
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar() {
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [renewalsDue, setRenewalsDue] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/v1/renewals/queue')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        // `total` is the accurate due-window count (a count(*) query, not the page of rows the
        // route returns) — using `rows.length` here froze the badge at the route's `limit` (300)
        // once the due window grew past it.
        if (typeof d.total === 'number') setRenewalsDue(d.total)
        else if (Array.isArray(d.rows)) setRenewalsDue(d.rows.length)
      })
      .catch(() => {})
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/auth/login'
  }

  // While /api/me is loading nothing is hidden (no flicker for managers); API guards are the real gate.
  const allowed = (item: NavLink) => !item.cap || !me?.capabilities || me.capabilities.includes(item.cap)

  const displayName = me?.name || me?.email || 'rent360'
  const displaySub = me?.email || (me ? 'admin' : '…')
  const initials = me?.name
    ? me.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('')
    : 'R3'

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 11.5 12 4l9 7.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 10.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="14" r="2.2" fill="white" />
          </svg>
        </div>
        <div className="sidebar-brand-text">
          rent<span style={{ color: 'var(--brand)' }}>360</span>
          <small>real estate ops</small>
        </div>
      </div>

      <div className="nav-section-label">ראשי</div>
      {main.filter(allowed).map(item => {
        const active = isActive(pathname, item.href)
        const badge = item.href === '/renewals' ? renewalsDue : item.badge
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${active ? 'active' : ''}`}
          >
            <span className="nav-icon"><item.Icon size={17} /></span>
            <span>{item.label}</span>
            {badge != null && <span className="nav-badge">{badge}</span>}
          </Link>
        )
      })}

      <div className="nav-section-label">תצוגה</div>
      {secondary.filter(allowed).map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${active ? 'active' : ''}`}
          >
            <span className="nav-icon"><item.Icon size={17} /></span>
            <span>{item.label}</span>
          </Link>
        )
      })}

      <div className="sidebar-footer">
        <div className="avatar-pill" title={me?.google.connected ? `Google מחובר: ${me.google.email}` : undefined}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me?.google.connected && <span style={{ color: '#16a34a' }}>● </span>}{displaySub}
          </div>
        </div>
        <button type="button" onClick={logout} className="icon-btn" style={{ width: 30, height: 30 }} aria-label="התנתק" title="התנתק">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  )
}
