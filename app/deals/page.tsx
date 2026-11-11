'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Topbar from '../../components/shell/Topbar'
import ExportButton from '../../components/ui/ExportButton'
import PivotBuilder from '../../components/ui/PivotBuilder'
import { InputCell, SelectCell } from '../../components/deals/cells'
import { useCan } from '../../lib/hooks/useMe'
import {
  WORK_STATUSES, RECRUIT_SOURCES, DOCS_STATUSES, PAYMENT_STATUSES, PAYMENT_METHODS, FINISHED,
  statusLabel, sourceLabel, docsLabel, paymentStatusLabel, paymentMethodLabel,
  buildForecast, monthKey, type DealRow, type WorkStatus,
} from '../../lib/deals/model'

type Agent = { id: string; name: string; handles: boolean }

const ils = (n: number | null | undefined) => (n == null ? '' : `₪${Math.round(n).toLocaleString('he-IL')}`)
const monthLabel = (m: string | null) => (m ? new Date(`${m}-15T12:00:00`).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }) : 'ללא תאריך צפוי')
const fmtDate = (v: string | null) => (v ? new Date(`${v}T12:00:00`).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '')

const STATUS_TONE: Record<WorkStatus, string> = {
  new_recruit: 'pill-gray', photo_publish: 'pill-gray', tours_marketing: 'pill-blue', offer_submitted: 'pill-purple',
  negotiation_draft: 'pill-purple', docs_check: 'pill-amber', contract_signing: 'pill-brand', closed_paid: 'pill-green', frozen_cancelled: 'pill-red',
}

// Which date the period filter applies to.
const PERIOD_FIELDS = [
  { key: 'recruitedAt', label: 'תאריך גיוס' },
  { key: 'signingDate', label: 'תאריך חתימה' },
  { key: 'expectedCloseDate', label: 'צפי סגירה' },
] as const
type PeriodField = (typeof PERIOD_FIELDS)[number]['key']

export default function DealsPage() {
  const [rows, setRows] = useState<DealRow[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const canPayment = useCan('commissions.manage') === true

  // Filters
  const [fHandler, setFHandler] = useState('')
  const [fRecruiter, setFRecruiter] = useState('')
  const [fSource, setFSource] = useState('')
  const [fStatus, setFStatus] = useState('open') // open | all | <status key>
  const [fPeriodField, setFPeriodField] = useState<PeriodField>('recruitedAt')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fText, setFText] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/deals', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error?.message || `שגיאה ${r.status}`)
      setRows(d.rows || [])
      setAgents(d.agents || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const agentName = useCallback((id: string | null) => (id ? agents.find(a => a.id === id)?.name || '—' : ''), [agents])

  /** Save one field: update the row on screen first, PATCH, and reload from the server if it was refused. */
  async function save(row: DealRow, patch: Record<string, unknown>, local: Partial<DealRow>) {
    setSaveError(null)
    setRows(prev => prev.map(r => (r.propertyId === row.propertyId ? { ...r, ...local } : r)))
    const res = await fetch(`/api/v1/deals/${row.propertyId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).catch(() => null)
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => null)
      setSaveError(d?.error?.message || 'השמירה נכשלה')
      void load()
      return
    }
    // Derived columns (expected fee, effective status, collection date) can change server-side.
    void load()
  }

  const filtered = useMemo(() => {
    const q = fText.trim().toLowerCase()
    return rows.filter(r => {
      if (fHandler && (fHandler === '__none__' ? r.handlerId : r.handlerId !== fHandler)) return false
      if (fRecruiter && (fRecruiter === '__none__' ? r.recruiterId : r.recruiterId !== fRecruiter)) return false
      if (fSource && r.recruitSource !== fSource) return false
      if (fStatus === 'open') { if (FINISHED.includes(r.status)) return false }
      else if (fStatus !== 'all' && r.status !== fStatus) return false
      if (fFrom || fTo) {
        const v = r[fPeriodField]
        if (!v) return false
        if (fFrom && v < fFrom) return false
        if (fTo && v > fTo) return false
      }
      if (q && !`${r.address} ${r.city} ${r.ownerName ?? ''} ${r.ownerPhone ?? ''} ${r.renterName ?? ''} ${r.renterPhone ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, fHandler, fRecruiter, fSource, fStatus, fPeriodField, fFrom, fTo, fText])

  // ---- Summary + forecast over what the filters show ----
  const summary = useMemo(() => {
    let inProcessDeals = 0, potential = 0, closedFee = 0, collected = 0, outstanding = 0
    const inProcess: WorkStatus[] = ['offer_submitted', 'negotiation_draft', 'docs_check', 'contract_signing']
    for (const r of filtered) {
      const fee = r.expectedFee ?? 0
      if (r.status === 'frozen_cancelled') continue
      if (inProcess.includes(r.status) && !r.hasTenancy) { inProcessDeals++; potential += fee }
      if (r.hasTenancy || r.status === 'closed_paid') {
        closedFee += fee
        if (r.paymentStatus === 'collected') collected += fee
        else if (r.paymentStatus !== 'waived') outstanding += fee
      }
    }
    return { inProcessDeals, potential, closedFee, collected, outstanding }
  }, [filtered])

  const forecast = useMemo(() => buildForecast(filtered
    .filter(r => !r.hasTenancy)
    .map(r => ({ status: r.status, month: monthKey(r.expectedCloseDate), agentId: r.handlerId, fee: r.expectedFee }))), [filtered])

  const handlers = agents.filter(a => a.handles || rows.some(r => r.handlerId === a.id))
  const agentOptions = agents.map(a => ({ key: a.id, label: a.name }))
  const filtersActive = !!(fHandler || fRecruiter || fSource || fFrom || fTo || fText.trim() || fStatus !== 'open')

  return (
    <>
      <Topbar crumb="בית · לוח עסקאות" title="לוח עסקאות, השכרה" />
      <div className="page-wrap">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
        ) : error ? (
          <div className="surface-card text-sm" style={{ padding: 16 }}>{error}</div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              <Stat label="נכסים בתצוגה" value={String(filtered.length)} />
              <Stat label="עסקאות בתהליך" value={String(summary.inProcessDeals)} sub={`פוטנציאל ${ils(summary.potential)}`} />
              <Stat label="עסקאות שנסגרו (עמלה)" value={ils(summary.closedFee)} />
              <Stat label="נגבה בפועל" value={ils(summary.collected)} tone="green" />
              <Stat label="טרם נגבה" value={ils(summary.outstanding)} tone="amber" />
            </div>

            {/* Filters */}
            <div className="surface-card mb-4 flex flex-wrap items-center gap-2" style={{ padding: 12 }}>
              <input value={fText} onChange={e => setFText(e.target.value)} placeholder="חיפוש: כתובת, בעל דירה, שוכר, טלפון" className="min-w-[200px] flex-1 rounded-md border border-brand-border px-3 py-2 text-sm" />
              <Filter value={fHandler} onChange={setFHandler} label="יועץ מטפל" options={[...handlers.map(a => ({ key: a.id, label: a.name })), { key: '__none__', label: 'ללא יועץ מטפל' }]} />
              <Filter value={fRecruiter} onChange={setFRecruiter} label="יועץ מגייס" options={[...agentOptions, { key: '__none__', label: 'לא הוגדר' }]} />
              <Filter value={fSource} onChange={setFSource} label="מקור גיוס" options={RECRUIT_SOURCES} />
              <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm" title="סטטוס עבודה">
                <option value="open">פתוחים (בלי סגורים ומוקפאים)</option>
                <option value="all">כל הסטטוסים</option>
                {WORK_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <select value={fPeriodField} onChange={e => setFPeriodField(e.target.value as PeriodField)} className="rounded-md border border-brand-border px-2 py-2 text-sm" title="לפי איזה תאריך לסנן">
                  {PERIOD_FIELDS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                מ-<input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm" />
                עד<input type="date" min={fFrom || undefined} value={fTo} onChange={e => setFTo(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm" />
              </span>
              {filtersActive && (
                <button type="button" className="text-xs text-brand-primary hover:underline" onClick={() => { setFHandler(''); setFRecruiter(''); setFSource(''); setFStatus('open'); setFFrom(''); setFTo(''); setFText('') }}>נקה סינון</button>
              )}
              <ExportButton
                disabled={filtered.length === 0}
                getSpec={() => ({
                  filename: 'לוח עסקאות השכרה',
                  rows: filtered,
                  columns: [
                    { header: 'תאריך גיוס', value: (r: DealRow) => (r.recruitedAt ? new Date(r.recruitedAt) : null), numFmt: 'dd/mm/yyyy', width: 12 },
                    { header: 'מקור גיוס', value: (r: DealRow) => sourceLabel(r.recruitSource), width: 12 },
                    { header: 'יועץ מגייס', value: (r: DealRow) => agentName(r.recruiterId), width: 14 },
                    { header: 'יועץ מטפל', value: (r: DealRow) => agentName(r.handlerId), width: 14 },
                    { header: 'כתובת', value: (r: DealRow) => r.address, width: 26 },
                    { header: 'עיר', value: (r: DealRow) => r.city, width: 14 },
                    { header: 'שם בעל הדירה', value: (r: DealRow) => r.ownerName, width: 18 },
                    { header: 'טלפון בעל הדירה', value: (r: DealRow) => r.ownerPhone, width: 16 },
                    { header: 'חדרים', value: (r: DealRow) => r.rooms, width: 8 },
                    { header: 'מחיר מבוקש', value: (r: DealRow) => r.askingPrice, numFmt: '₪#,##0', width: 12 },
                    { header: 'סטטוס עבודה', value: (r: DealRow) => statusLabel(r.status), width: 22 },
                    { header: 'ימים בסטטוס', value: (r: DealRow) => r.daysInStatus, width: 10 },
                    { header: 'צפי סגירה', value: (r: DealRow) => (r.expectedCloseDate ? new Date(r.expectedCloseDate) : null), numFmt: 'dd/mm/yyyy', width: 12 },
                    { header: 'מחיר סגירה', value: (r: DealRow) => r.closingPrice, numFmt: '₪#,##0', width: 12 },
                    { header: 'שם השוכר', value: (r: DealRow) => r.renterName, width: 18 },
                    { header: 'טלפון השוכר', value: (r: DealRow) => r.renterPhone, width: 16 },
                    { header: 'תאריך חתימה', value: (r: DealRow) => (r.signingDate ? new Date(r.signingDate) : null), numFmt: 'dd/mm/yyyy', width: 12 },
                    { header: 'בדיקת מסמכים וערבים', value: (r: DealRow) => docsLabel(r.docsStatus), width: 16 },
                    { header: 'דמי תיווך צפויים', value: (r: DealRow) => r.expectedFee, numFmt: '₪#,##0', width: 14 },
                    { header: 'סטטוס תשלום', value: (r: DealRow) => paymentStatusLabel(r.paymentStatus), width: 14 },
                    { header: 'אמצעי תשלום', value: (r: DealRow) => paymentMethodLabel(r.paymentMethod), width: 14 },
                    { header: 'מספר חשבונית או קבלה', value: (r: DealRow) => r.invoiceNumber, width: 16 },
                    { header: 'תאריך גבייה בפועל', value: (r: DealRow) => (r.collectedAt ? new Date(r.collectedAt) : null), numFmt: 'dd/mm/yyyy', width: 14 },
                    { header: 'הערות', value: (r: DealRow) => r.note, width: 40 },
                  ],
                })}
              />
            </div>

            {saveError && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">{saveError}</div>}

            {/* Table */}
            <div className="surface-card mb-6" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="w-full text-sm" style={{ minWidth: 2600, borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr className="text-xs text-gray-500">
                    {['תאריך גיוס', 'מקור גיוס', 'יועץ מגייס', 'יועץ מטפל', 'כתובת', 'עיר', 'בעל הדירה', 'טלפון בעל הדירה', 'חדרים', 'מחיר מבוקש', 'סטטוס עבודה', 'צפי סגירה', 'מחיר סגירה', 'שוכר', 'טלפון שוכר', 'תאריך חתימה', 'מסמכים וערבים', 'דמי תיווך צפויים', 'סטטוס תשלום', 'אמצעי תשלום', 'חשבונית / קבלה', 'תאריך גבייה', 'הערות'].map((h, i) => (
                      <th key={h} className="whitespace-nowrap border-b border-brand-border bg-gray-50 px-2 py-2 text-right font-medium" style={i === 4 ? { position: 'sticky', right: 0, zIndex: 2 } : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={23} className="p-8 text-center text-sm text-gray-500">אין נכסים שמתאימים לסינון.</td></tr>
                  )}
                  {filtered.map(r => (
                    <tr key={r.propertyId} className="align-middle hover:bg-gray-50/60">
                      <Td><InputCell type="date" value={r.recruitedAt} onSave={v => save(r, { recruited_at: v }, { recruitedAt: v })} width={120} /></Td>
                      <Td>
                        <SelectCell value={r.recruitSource} options={RECRUIT_SOURCES} onSave={v => save(r, { recruit_source: v }, { recruitSource: v ?? r.recruitSource, recruitSourceDerived: false })} />
                      </Td>
                      <Td><SelectCell value={r.recruiterId} options={agentOptions} onSave={v => save(r, { recruited_by_user_id: v }, { recruiterId: v })} /></Td>
                      <Td><SelectCell value={r.handlerId} options={agentOptions} onSave={v => save(r, { handler_user_id: v }, { handlerId: v })} emptyLabel="ללא יועץ" /></Td>
                      <Td sticky><Link href={`/properties/${r.propertyId}`} className="whitespace-nowrap font-medium text-brand-primary hover:underline">{r.address}</Link></Td>
                      <Td>{r.city}</Td>
                      <Td>{r.ownerName}</Td>
                      <Td><span dir="ltr">{r.ownerPhone}</span></Td>
                      <Td>{r.rooms}</Td>
                      <Td>{ils(r.askingPrice)}</Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <SelectCell value={r.status} options={WORK_STATUSES} onSave={v => v && save(r, { work_status: v }, { status: v as WorkStatus, daysInStatus: 0 })} />
                          <span className={`pill ${STATUS_TONE[r.status]} whitespace-nowrap`} title="ימים בסטטוס">{r.daysInStatus}י׳</span>
                        </div>
                      </Td>
                      <Td><InputCell type="date" value={r.expectedCloseDate} onSave={v => save(r, { expected_close_date: v }, { expectedCloseDate: v })} width={120} /></Td>
                      <Td><InputCell type="number" value={r.closingPrice} onSave={v => save(r, { closing_price: v }, { closingPrice: v == null ? null : Number(v) })} width={90} /></Td>
                      <Td><InputCell value={r.renterName} disabled={r.hasTenancy} onSave={v => save(r, { deal_renter_name: v }, { renterName: v })} width={120} /></Td>
                      <Td><InputCell value={r.renterPhone} disabled={r.hasTenancy} dir="ltr" onSave={v => save(r, { deal_renter_phone: v }, { renterPhone: v })} width={120} /></Td>
                      <Td><InputCell type="date" value={r.signingDate} onSave={v => save(r, { signing_date: v }, { signingDate: v })} width={120} /></Td>
                      <Td><SelectCell value={r.docsStatus} options={DOCS_STATUSES} onSave={v => v && save(r, { docs_status: v }, { docsStatus: v })} /></Td>
                      <Td>
                        <InputCell
                          type="number" value={r.expectedFee} disabled={!canPayment} width={90}
                          {...(r.feeIsOverride ? {} : { placeholder: 'אוטומטי' })}
                          onSave={v => save(r, { expected_fee: v }, { expectedFee: v == null ? r.expectedFee : Number(v), feeIsOverride: v != null })}
                        />
                      </Td>
                      <Td><SelectCell value={r.paymentStatus} options={PAYMENT_STATUSES} disabled={!canPayment} onSave={v => v && save(r, { payment_status: v }, { paymentStatus: v })} /></Td>
                      <Td><SelectCell value={r.paymentMethod} options={PAYMENT_METHODS} disabled={!canPayment} onSave={v => save(r, { payment_method: v }, { paymentMethod: v })} /></Td>
                      <Td><InputCell value={r.invoiceNumber} disabled={!canPayment} onSave={v => save(r, { invoice_number: v }, { invoiceNumber: v })} width={100} /></Td>
                      <Td><InputCell type="date" value={r.collectedAt} disabled={!canPayment} onSave={v => save(r, { collected_at: v }, { collectedAt: v })} width={120} /></Td>
                      <Td><InputCell value={r.note} onSave={v => save(r, { note: v }, { note: v })} width={200} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Forecast */}
            <h2 className="font-display mb-2" style={{ fontSize: 18 }}>צפי הכנסות, עסקאות בתהליך</h2>
            <p className="text-xs faint mb-3">עסקאות מהצעה ועד חתימה שעוד לא נחתמו, לפי חודש צפוי לסגירה וליועץ המטפל. משתמש בסינון שלמעלה.</p>
            {forecast.length === 0 ? (
              <div className="surface-card p-6 text-center text-sm text-gray-500">אין כרגע עסקאות בתהליך בתצוגה.</div>
            ) : (
              <div className="surface-card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      {['חודש צפוי', 'יועץ מטפל', 'עסקאות', 'דמי תיווך צפויים'].map(h => <th key={h} className="border-b border-brand-border bg-gray-50 px-3 py-2 text-right font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map(f => (
                      <tr key={`${f.month}|${f.agentId}`}>
                        <td className="px-3 py-2">{monthLabel(f.month)}</td>
                        <td className="px-3 py-2">{f.agentId ? agentName(f.agentId) : 'ללא יועץ'}</td>
                        <td className="px-3 py-2 num">{f.deals}</td>
                        <td className="px-3 py-2 num">{ils(f.fee)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="border-t border-brand-border px-3 py-2" colSpan={2}>סה״כ</td>
                      <td className="border-t border-brand-border px-3 py-2 num">{forecast.reduce((s, f) => s + f.deals, 0)}</td>
                      <td className="border-t border-brand-border px-3 py-2 num">{ils(forecast.reduce((s, f) => s + f.fee, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {forecast.length > 0 && (
              <div className="mt-2">
                <ExportButton
                  label="ייצוא הצפי לאקסל"
                  getSpec={() => ({
                    filename: 'צפי הכנסות',
                    rows: forecast,
                    columns: [
                      { header: 'חודש צפוי', value: f => monthLabel(f.month), width: 18 },
                      { header: 'יועץ מטפל', value: f => (f.agentId ? agentName(f.agentId) : 'ללא יועץ'), width: 16 },
                      { header: 'עסקאות', value: f => f.deals, width: 10 },
                      { header: 'דמי תיווך צפויים', value: f => f.fee, numFmt: '₪#,##0', width: 16 },
                    ],
                  })}
                />
              </div>
            )}
            <div className="mt-6">
              <PivotBuilder
                rows={filtered}
                filename="פילוח עסקאות"
                dimensions={[
                  { key: 'handler', label: 'יועץ מטפל', get: (r: DealRow) => agentName(r.handlerId) },
                  { key: 'recruiter', label: 'יועץ מגייס', get: (r: DealRow) => agentName(r.recruiterId) },
                  { key: 'status', label: 'סטטוס עבודה', get: (r: DealRow) => statusLabel(r.status) },
                  { key: 'source', label: 'מקור גיוס', get: (r: DealRow) => sourceLabel(r.recruitSource) },
                  { key: 'city', label: 'עיר', get: (r: DealRow) => r.city },
                  { key: 'rooms', label: 'חדרים', get: (r: DealRow) => (r.rooms != null ? String(r.rooms) : null) },
                  { key: 'recruitMonth', label: 'חודש גיוס', get: (r: DealRow) => monthKey(r.recruitedAt) },
                  { key: 'closeMonth', label: 'חודש צפי סגירה', get: (r: DealRow) => monthKey(r.expectedCloseDate) },
                  { key: 'signMonth', label: 'חודש חתימה', get: (r: DealRow) => monthKey(r.signingDate) },
                  { key: 'payment', label: 'סטטוס תשלום', get: (r: DealRow) => paymentStatusLabel(r.paymentStatus) },
                  { key: 'docs', label: 'מסמכים וערבים', get: (r: DealRow) => docsLabel(r.docsStatus) },
                ]}
                measures={[
                  { key: 'fee', label: 'דמי תיווך צפויים', money: true, get: (r: DealRow) => r.expectedFee },
                  { key: 'collected', label: 'נגבה בפועל', money: true, get: (r: DealRow) => (r.paymentStatus === 'collected' ? r.expectedFee : 0) },
                  { key: 'outstanding', label: 'טרם נגבה (עסקאות שנחתמו)', money: true, get: (r: DealRow) => ((r.hasTenancy || r.status === 'closed_paid') && r.paymentStatus === 'pending' ? r.expectedFee : 0) },
                  { key: 'asking', label: 'סך מחיר מבוקש', money: true, get: (r: DealRow) => r.askingPrice },
                  { key: 'closing', label: 'סך מחיר סגירה', money: true, get: (r: DealRow) => r.closingPrice },
                ]}
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Td({ children, sticky }: { children?: React.ReactNode; sticky?: boolean }) {
  return (
    <td
      className="whitespace-nowrap border-b border-brand-border px-1.5 py-1"
      style={sticky ? { position: 'sticky', right: 0, background: 'var(--paper, #fff)', zIndex: 1 } : undefined}
    >
      {children}
    </td>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'amber' }) {
  return (
    <div className="surface-card" style={{ padding: 14 }}>
      <div className="faint text-xs mb-1">{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color: tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : undefined }}>{value}</div>
      {sub && <div className="text-xs faint mt-0.5">{sub}</div>}
    </div>
  )
}

function Filter({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: ReadonlyArray<{ key: string; label: string }> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="rounded-md border border-brand-border px-2 py-2 text-sm" title={label}>
      <option value="">{label}: הכל</option>
      {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}
