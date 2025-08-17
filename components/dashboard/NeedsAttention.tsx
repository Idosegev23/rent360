export default function NeedsAttention({ items }: { items: any[] }){
  if(!items || items.length === 0){
    return (
      <div className="rounded-lg border border-brand-border bg-white p-4 text-sm text-brand-inkMuted">אין כרגע דברים לטיפול. מעולה!</div>
    )
  }
  return (
    <div className="rounded-lg border border-brand-border bg-white p-4">
      <h3 className="mb-2 text-base font-semibold">צריך טיפול</h3>
      <ul className="space-y-2 text-sm">
        {items.map((m) => (
          <li key={m.id} className="flex items-center justify-between">
            <span className="truncate">כשל בשליחה – ליד {m.lead_id?.slice(0,8)}…</span>
            <button className="rounded-md bg-brand-primary px-3 py-1 text-white">נסו שוב</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
