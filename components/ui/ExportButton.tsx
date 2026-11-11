'use client'
import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { exportToExcel, type ExportSpec } from '../../lib/export/xlsx'

/**
 * "ייצוא לאקסל" — pass the rows currently shown (after filters) and the columns in display order.
 * `getSpec` is called on click so it always exports the latest filtered rows, not a stale snapshot;
 * it may be async for lists that are paged on screen but should export every matching row.
 */
export default function ExportButton<T>({ getSpec, label = 'ייצוא לאקסל', disabled }: { getSpec: () => ExportSpec<T> | Promise<ExportSpec<T>>; label?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    if (busy) return
    setBusy(true)
    try { await exportToExcel(await getSpec()) } catch (e) { alert('הייצוא נכשל. נסו שוב.'); console.error('[export]', e) } finally { setBusy(false) }
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {label}
    </button>
  )
}
