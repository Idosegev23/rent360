'use client'
export default function MatchesListClient({ items, propertyId }: { items: any[]; propertyId: string }){
  return (
    <ul className="space-y-2">
      {items.map((m:any) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-border p-2">
          <div className="text-sm">ליד {m.lead_id?.slice(0,8)}…</div>
          <div className="text-sm font-semibold">ציון {m.score}</div>
          {m.missingRequired?.length>0 && (
            <div className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">חסר חובה: {m.missingRequired.join(', ')}</div>
          )}
          <div className="text-xs text-brand-inkMuted">{m.status}</div>
          <form action="/api/v1/messages/send" method="post" className="ml-auto">
            <input type="hidden" name="lead_id" value={m.lead_id} />
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="template" value={'היי {{full_name}}, יש לי נכס ב{{city}} {{neighborhood}} במחיר {{price}} ₪, {{rooms}} חדרים, {{sqm}} מ"ר. לקישור: {{link}}'} />
            <button className="rounded-md bg-brand-primary px-3 py-1 text-white">שלח הודעה</button>
          </form>
        </li>
      ))}
    </ul>
  )
}

