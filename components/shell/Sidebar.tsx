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
  ChevronDown,
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

// Daily work stays one click away; everything else sits in groups that open on demand.
const core: NavLink[] = [
  { href: '/dashboard', label: 'דשבורד',  Icon: LayoutDashboard },
  { href: '/tasks',     label: 'משימות',  Icon: CheckSquare },
  { href: '/meetings',  label: 'פגישות',  Icon: CalendarDays },
  { href: '/inbox',     label: 'שיחות',   Icon: Inbox },
]

type NavGroup = { key: string; label: string; Icon: React.ComponentType<{ size?: number }>; items: NavLink[] }
const groups: NavGroup[] = [
  { key: 'deals', label: 'עסקאות', Icon: Table2, items: [
    { href: '/deals',       label: 'לוח עסקאות',   Icon: Table2 },
    { href: '/board',       label: 'לוח בקרה ליועץ', Icon: Target },
    { href: '/pipeline',    label: 'צינור עסקאות', Icon: GitBranch },
    { href: '/commissions', label: 'עמלות',        Icon: Coins },
  ] },
  { key: 'properties', label: 'נכסים', Icon: Building2, items: [
    { href: '/properties',          label: 'כל הנכסים',       Icon: Building2 },
    { href: '/approved-properties', label: 'מאושרים',         Icon: CheckCircle2 },
    { href: '/rented',              label: 'הושכרו על ידינו', Icon: KeyRound },
    { href: '/approved-properties/irrelevant', label: 'לא רלוונטיים', Icon: Archive },
  ] },
  { key: 'clients', label: 'לקוחות ושיווק', Icon: Users, items: [
    { href: '/renters',               label: 'שוכרים',      Icon: Users },
    { href: '/renewals',              label: 'לידי חידוש',  Icon: History, cap: 'outreach.send' },
    { href: '/outreach',              label: 'שליחה',       Icon: Send, cap: 'outreach.send' },
    { href: '/outreach/renter-sends', label: 'יומן שליחות', Icon: ClipboardList, cap: 'outreach.send' },
  ] },
  { key: 'admin', label: 'ניהול', Icon: Settings, items: [
    { href: '/reports', label: 'דוחות',  Icon: BarChart3, cap: 'reports.view' },
    { href: '/team',    label: 'צוות',   Icon: UserCog },
    { href: '/admin',   label: 'הגדרות', Icon: Settings },
  ] },
]

const OPEN_KEY = 'sidebar-open-groups'

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/dashboard') return pathname === '/' || pathname.startsWith('/dashboard')
  // '/outreach' and '/approved-properties' have their own children in the menu; don't light both up.
  if (href === '/outreach' || href === '/approved-properties') return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar() {
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [renewalsDue, setRenewalsDue] = useState<number | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try { setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')) } catch { /* private mode */ }
  }, [])
  function toggle(key: string, isOpen: boolean) {
    setOpen(prev => {
      const next = { ...prev, [key]: !isOpen }
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }

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

      {core.map(item => <NavItem key={item.href} item={item} active={isActive(pathname, item.href)} />)}

      {groups.map(g => {
        const items = g.items.filter(allowed)
        if (items.length === 0) return null
        const hasActive = items.some(i => isActive(pathname, i.href))
        // The group holding the current page is always open; others remember what the user chose.
        const isOpen = hasActive || !!open[g.key]
        const groupBadge = !isOpen && items.some(i => i.href === '/renewals') ? renewalsDue : null
        return (
          <div key={g.key} className="nav-group">
            <button type="button" className={`nav-item nav-group-head ${hasActive && !isOpen ? 'active' : ''}`} onClick={() => !hasActive && toggle(g.key, isOpen)} aria-expanded={isOpen}>
              <span className="nav-icon"><g.Icon size={17} /></span>
              <span>{g.label}</span>
              {groupBadge != null && groupBadge > 0 && <span className="nav-badge">{groupBadge}</span>}
              <ChevronDown size={14} className="nav-chevron" style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
            </button>
            {isOpen && (
              <div className="nav-group-items">
                {items.map(item => (
                  <NavItem key={item.href} item={item} active={isActive(pathname, item.href)} badge={item.href === '/renewals' ? renewalsDue : item.badge} />
                ))}
              </div>
            )}
          </div>
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

function NavItem({ item, active, badge }: { item: NavLink; active: boolean; badge?: number | string | null | undefined }) {
  return (
    <Link href={item.href} className={`nav-item ${active ? 'active' : ''}`}>
      <span className="nav-icon"><item.Icon size={17} /></span>
      <span>{item.label}</span>
      {badge != null && <span className="nav-badge">{badge}</span>}
    </Link>
  )
}
