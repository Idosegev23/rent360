'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/dashboard', label: 'דשבורד' },
  { href: '/properties', label: 'נכסים' },
  { href: '/leads', label: 'לידים' },
  { href: '/matches', label: 'התאמות' },
  { href: '/inbox', label: 'הודעות' },
]

export default function BottomTabs(){
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-brand-border bg-brand-surface">
      <ul className="mx-auto flex max-w-xl items-center justify-between gap-1 px-2 py-2">
        {tabs.map(t => {
          const active = (pathname?.startsWith(t.href)) ?? false
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={[
                  'block rounded-md px-3 py-2 text-center text-sm',
                  active ? 'bg-brand-bg font-semibold text-brand-ink' : 'text-brand-inkMuted hover:bg-brand-bg'
                ].join(' ')}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
