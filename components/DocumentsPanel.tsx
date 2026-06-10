'use client'
import { useEffect, useState } from 'react'
import { FileText, Plus, ExternalLink, X } from 'lucide-react'

type Doc = { id: string; name: string; url: string; kind: string | null; created_at: string }
type EntityType = 'property' | 'renter' | 'tenancy' | 'thread'

const KINDS: Array<{ k: string; label: string }> = [
  { k: 'broker_agreement', label: 'הסכם תיווך' },
  { k: 'contract', label: 'חוזה שכירות' },
  { k: 'id', label: 'תעודת זהות' },
  { k: 'payslip', label: 'תלושי שכר' },
  { k: 'guarantee', label: 'ביטחונות/ערבות' },
  { k: 'other', label: 'אחר' },
]
const kindLabel = (k: string | null) => KINDS.find(x => x.k === k)?.label || 'מסמך'

/** Link-based documents (Google Drive etc.) attached to a property/renter/deal — broker agreement,
 *  IDs, payslips, contract. We accompany signing; this is where the paper trail lives. */
export default function DocumentsPanel({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', url: '', kind: 'broker_agreement' })
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/v1/documents?entity_type=${entityType}&entity_id=${entityId}`)
      const d = await r.json(); setDocs(d.documents || [])
    } catch {/* noop */}
  }
  useEffect(() => { load() }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (busy || !f.name.trim() || !f.url.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/v1/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_type: entityType, entity_id: entityId, ...f }) })
      if (!r.ok) throw new Error('failed')
      setF({ name: '', url: '', kind: 'broker_agreement' }); setOpen(false); load()
    } catch { window.alert('הוספת המסמך נכשלה') } finally { setBusy(false) }
  }
  async function remove(id: string) {
    setDocs(ds => ds.filter(d => d.id !== id))
    await fetch(`/api/v1/documents?id=${id}`, { method: 'DELETE' }).catch(() => load())
  }

  return (
    <div className="surface-card" style={{ padding: 14 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="faint inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 700 }}><FileText size={13} /> מסמכים</span>
        <button onClick={() => setOpen(o => !o)} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--brand)' }}><Plus size={13} /> הוסף קישור</button>
      </div>
      {open && (
        <div className="space-y-2 mb-2 rounded-md bg-gray-50 p-2">
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="שם המסמך" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
          <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="קישור (Google Drive וכו׳)" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs" dir="ltr" />
          <div className="flex gap-2">
            <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs flex-1">
              {KINDS.map(k => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select>
            <button onClick={add} disabled={busy} className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">הוסף</button>
          </div>
        </div>
      )}
      {docs.length === 0 ? <div className="text-sm faint py-1">אין מסמכים עדיין.</div> : docs.map(d => (
        <div key={d.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="pill pill-gray" style={{ fontSize: 10 }}>{kindLabel(d.kind)}</span>
          <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm inline-flex items-center gap-1" style={{ color: 'var(--brand-ink, var(--brand))' }}>{d.name}<ExternalLink size={11} /></a>
          <button onClick={() => remove(d.id)} className="text-gray-400 hover:text-red-600" title="הסר"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}
