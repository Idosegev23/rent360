export default function LeadCard({ item }: { item: any }){
  return (
    <div className="rounded-lg border border-brand-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{item.full_name}</h3>
        <span className="text-sm text-brand-inkMuted">{item.phone}</span>
      </div>
      <div className="mt-2 text-sm text-brand-inkMuted">{item.status || '—'}</div>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <span className="font-semibold">תקציב: ₪{(item.budget_min||0).toLocaleString()}–₪{(item.budget_max||0).toLocaleString()}</span>
        <span>חדרים: {item.preferred_rooms || '—'}</span>
      </div>
      <div className="mt-2 text-xs text-brand-inkMuted">
        {Array.isArray(item.preferred_cities) ? item.preferred_cities.join(' · ') : ''}
      </div>
    </div>
  )
}
