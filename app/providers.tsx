'use client'
import { usePathname } from 'next/navigation'
import BottomTabs from '../components/BottomTabs'
import Sidebar from '../components/shell/Sidebar'

const FULL_BLEED_PREFIXES = ['/share/', '/r/', '/auth/']

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isFullBleed = FULL_BLEED_PREFIXES.some(p => pathname?.startsWith(p))

  if (isFullBleed) {
    return <>{children}</>
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-pane">
        {children}
      </main>
      <BottomTabs />
    </div>
  )
}
