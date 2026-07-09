'use client'
import { useEffect, useState } from 'react'
import { FileText, Plus, ExternalLink, X, Upload, Loader2 } from 'lucide-react'
import { supabaseBrowser } from '../lib/supabase'

type Doc = { id: string; name: string; url: string; kind: string | null; storage_path?: string | null; created_at: string }
type EntityType = 'property' | 'renter' | 'tenancy' | 'thread'

const KINDS: Array<{ k: string; label: string }> = [
  { k: 'broker_agreement', label: 'הסכם תיווך' },
  { k: 'commission_proof', label: 'הוכחת עמלה' },
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
  const [uploading, setUploading] = useState(false)

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      // 1) get a signed upload URL from the server (service role)
      const u = await fetch('/api/v1/documents/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, filename: file.name }),
      })
      const ud = await u.json().catch(() => ({}))
      if (!u.ok) throw new Error(ud?.error?.message || ud?.error?.code || 'signing failed')
      // 2) upload the file DIRECTLY to Supabase Storage — bypasses Vercel's ~4.5MB request limit
      const { error: upErr } = await supabaseBrowser().storage
        .from('deal-docs')
        .uploadToSignedUrl(ud.path, ud.token, file, { contentType: file.type || 'application/octet-stream' })
      if (upErr) throw new Error(upErr.message)
      // 3) record the document row (so it appears in the list + is served via signed URL)
      const c = await fetch('/api/v1/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, name: file.name, kind: f.kind, storage_path: ud.path }),
      })
      const cd = await c.json().catch(() => ({}))
      if (!c.ok) throw new Error(cd?.error?.message || cd?.error?.code || 'save failed')
      load()
    } catch (e) { window.alert('העלאת הקובץ נכשלה: ' + (e instanceof Error ? e.message : '')) } finally { setUploading(false) }
  }

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
        <div className="flex items-center gap-3">
          <label className="text-xs inline-flex items-center gap-1 cursor-pointer" style={{ color: 'var(--brand)' }} title="העלאת קובץ/צילום פרטי (חוזה, ת״ז, תלוש)">
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload size={13} />}
            {uploading ? 'מעלה…' : 'העלה קובץ'}
            <input type="file" className="hidden" disabled={uploading} onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.target.value = '' }} />
          </label>
          <button onClick={() => setOpen(o => !o)} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--brand)' }}><Plus size={13} /> הוסף קישור</button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 mb-2 rounded-md bg-gray-50 p-2">
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="שם המסמך" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
          <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="קישור (Google Drive וכו׳)" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs" dir="ltr" />
          <div className="flex gap-2">
            <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs flex-1">
              {KINDS.map(k => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select>
            <button onClick={add} disabled={busy || !f.url.trim()} className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">הוסף קישור</button>
          </div>
          <label className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2 py-2 text-xs text-gray-600 cursor-pointer hover:bg-gray-100">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'מעלה…' : 'או העלאת קובץ/צילום (פרטי)'}
            <input type="file" className="hidden" disabled={uploading} onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.target.value = '' }} />
          </label>
        </div>
      )}
      {docs.length === 0 ? <div className="text-sm faint py-1">אין מסמכים עדיין.</div> : docs.map(d => (
        <div key={d.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="pill pill-gray" style={{ fontSize: 10 }}>{kindLabel(d.kind)}</span>
          <a href={d.storage_path ? `/api/v1/documents/${d.id}/file` : d.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm inline-flex items-center gap-1" style={{ color: 'var(--brand-ink, var(--brand))' }}>{d.name}<ExternalLink size={11} /></a>
          <button onClick={() => remove(d.id)} className="text-gray-400 hover:text-red-600" title="הסר"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}
