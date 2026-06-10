'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  Users,
  Inbox,
  CheckCircle2,
  Settings,
  ChevronDown,
  Send,
  ListChecks,
  Archive,
  UserCog,
} from 'lucide-react'

type NavLink = {
  href: string
  label: string
  Icon: React.ComponentType<{ size?: number }>
  badge?: number | string
}

const main: NavLink[] = [
  { href: '/dashboard',            label: 'דשבורד',         Icon: LayoutDashboard },
  { href: '/action',               label: 'מה לעשות',        Icon: ListChecks },
  { href: '/properties',           label: 'נכסים',           Icon: Building2 },
  { href: '/approved-properties',  label: 'מאושרים',        Icon: CheckCircle2 },
  { href: '/approved-properties/irrelevant', label: 'לא רלוונטיים', Icon: Archive },
  { href: '/renters',              label: 'שוכרים',          Icon: Users },
  { href: '/team',                 label: 'צוות',            Icon: UserCog },
  { href: '/outreach',             label: 'שליחה',           Icon: Send },
  { href: '/inbox',                label: 'שיחות',           Icon: Inbox },
]

const secondary: NavLink[] = [
  { href: '/admin', label: 'הגדרות', Icon: Settings },
]

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/dashboard') return pathname === '/' || pathname.startsWith('/dashboard')
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar() {
  const pathname = usePathname()
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
      {main.map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${active ? 'active' : ''}`}
          >
            <span className="nav-icon"><item.Icon size={17} /></span>
            <span>{item.label}</span>
            {item.badge != null && <span className="nav-badge">{item.badge}</span>}
          </Link>
        )
      })}

      <div className="nav-section-label">תצוגה</div>
      {secondary.map(item => {
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
        <div className="avatar-pill">R3</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>rent360</div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>admin</div>
        </div>
        <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="more">
          <ChevronDown size={14} />
        </button>
      </div>
    </aside>
  )
}
