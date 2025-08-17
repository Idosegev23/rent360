import Link from 'next/link'

export default function KpiCard({ label, value, href }: { label: string; value: string | number | null; href?: string }){
  const content = (
    <div className="rounded-lg border border-brand-border bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="text-sm text-brand-inkMuted">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
    </div>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}
