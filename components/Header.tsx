import Link from 'next/link'

export default function Header(){
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-brand-border bg-brand-surface/80 backdrop-blur supports-[backdrop-filter]:bg-brand-surface/60">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-semibold">Rent360</span>
        <div className="flex items-center gap-2 text-sm text-brand-inkMuted">
          <Link href="/properties/new" className="rounded-md bg-brand-primary px-3 py-1.5 text-white hover:opacity-90">הוסף נכס</Link>
          <Link href="/leads/new" className="rounded-md border border-brand-border px-3 py-1.5 hover:bg-brand-bg">הוסף לקוח</Link>
        </div>
      </div>
    </header>
  )
}
