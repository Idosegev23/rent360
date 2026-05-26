'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Building2, CheckCircle2, Users, Inbox } from 'lucide-react'

const tabs = [
  { href: '/dashboard',           label: 'דשבורד',  Icon: LayoutDashboard },
  { href: '/properties',          label: 'נכסים',   Icon: Building2 },
  { href: '/approved-properties', label: 'מאושרים', Icon: CheckCircle2 },
  { href: '/renters',             label: 'שוכרים',  Icon: Users },
  { href: '/inbox',               label: 'שיחות',   Icon: Inbox },
]

export default function BottomTabs() {
  const pathname = usePathname()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
      style={{
        borderColor: 'var(--line)',
        background: 'color-mix(in oklab, var(--paper) 92%, transparent)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between gap-1 px-2 py-2">
        {tabs.map(t => {
          const active = (pathname?.startsWith(t.href)) ?? false
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className="flex flex-col items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors"
                style={{
                  color: active ? 'var(--ink)' : 'var(--ink-3)',
                  background: active ? 'var(--paper-2)' : 'transparent',
                }}
              >
                <t.Icon size={18} />
                <span>{t.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
