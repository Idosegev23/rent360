'use client'
import type { ReactNode } from 'react'
import { Search, Bell } from 'lucide-react'

type Props = {
  crumb?: string
  title: string
  action?: ReactNode
  showSearch?: boolean
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

      <button type="button" className="icon-btn" title="התראות" aria-label="notifications">
        <Bell size={16} />
        <span className="alert-dot" />
      </button>

      {action}
    </header>
  )
}
