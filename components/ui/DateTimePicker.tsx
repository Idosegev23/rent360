'use client'
import { useState } from 'react'
import { ChevronRight, ChevronLeft, Clock, CalendarDays, ChevronsRight, CalendarCheck } from 'lucide-react'

/* ---------------------------------------------------------------------------
 * Date+time picker modal (Hebrew RTL, Sunday-first), styled after the design:
 * month grid + quick options (היום / מחר / שבוע הבא) + a time row.
 * Pair with <DateTimeField> for a button-that-opens-the-picker.
 * ------------------------------------------------------------------------- */

const HE_WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] // Sun..Sat

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function monthMatrix(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const start = addDays(first, -first.getDay()) // back to Sunday
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

function fmtListDate(d: Date) {
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function DateTimePicker(props: {
  initial?: Date | null
  withTime?: boolean
  onConfirm: (d: Date) => void
  onClose: () => void
}) {
  const withTime = props.withTime !== false
  const now = new Date()
  const init = props.initial || now
  const [view, setView] = useState(new Date(init.getFullYear(), init.getMonth(), 1))
  const [selected, setSelected] = useState<Date>(startOfDay(init))
  const [time, setTime] = useState(
    props.initial
      ? `${String(init.getHours()).padStart(2, '0')}:${String(init.getMinutes()).padStart(2, '0')}`
      : '17:00',
  )

  const today = startOfDay(now)
  const cells = monthMatrix(view)

  const quick = [
    { label: 'היום', date: today, Icon: CalendarCheck },
    { label: 'מחר', date: addDays(today, 1), Icon: ChevronRight },
    { label: 'שבוע הבא', date: addDays(today, 7), Icon: ChevronsRight },
  ]

  function pick(d: Date) {
    setSelected(startOfDay(d))
    if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  function confirm() {
    const [h, m] = withTime ? time.split(':').map(Number) : [0, 0]
    props.onConfirm(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h || 0, m || 0))
  }

  return (
    <div
      dir="rtl"
      onClick={props.onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-bold capitalize">{view.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="חודש קודם"><ChevronRight className="h-5 w-5" /></button>
            <button onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="חודש הבא"><ChevronLeft className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Weekdays */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-400">
          {HE_WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === view.getMonth()
            const isSel = sameDay(d, selected)
            const isToday = sameDay(d, today)
            return (
              <button
                key={i}
                onClick={() => pick(d)}
                className="flex aspect-square items-center justify-center rounded-full text-sm"
                style={
                  isSel
                    ? { background: 'var(--brand, #2563eb)', color: '#fff', fontWeight: 700 }
                    : { color: inMonth ? 'var(--ink, #111)' : '#cbd5e1', fontWeight: isToday ? 700 : 400, boxShadow: isToday ? 'inset 0 0 0 1.5px var(--brand, #2563eb)' : 'none' }
                }
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>

        {/* Quick options */}
        <div className="mt-3 border-t border-gray-100 pt-2">
          {quick.map((q) => {
            const active = sameDay(q.date, selected)
            return (
              <button key={q.label} onClick={() => pick(q.date)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 hover:bg-gray-50">
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: active ? 'var(--brand, #2563eb)' : 'var(--ink, #111)' }}>
                  <q.Icon className="h-[18px] w-[18px]" /> {q.label}
                </span>
                <span className="text-sm text-gray-500">{fmtListDate(q.date)}</span>
              </button>
            )
          })}
        </div>

        {/* Time */}
        {withTime && (
          <div className="mt-1 flex items-center justify-between border-t border-gray-100 px-2 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold"><Clock className="h-[18px] w-[18px]" /> שעה</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm font-semibold" />
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex gap-2">
          <button onClick={props.onClose} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600">ביטול</button>
          <button onClick={confirm} className="flex-1 rounded-lg py-2 text-sm font-medium text-white" style={{ background: 'var(--brand, #2563eb)' }}>קבע</button>
        </div>
      </div>
    </div>
  )
}

/** Button that shows the chosen date/time and opens the picker modal. */
export function DateTimeField(props: {
  value: Date | null
  onChange: (d: Date) => void
  placeholder?: string
  withTime?: boolean
}) {
  const [open, setOpen] = useState(false)
  const withTime = props.withTime !== false
  const label = props.value
    ? props.value.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) })
    : props.placeholder || 'בחר תאריך'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md border border-brand-border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        <span className={props.value ? '' : 'text-gray-400'}>{label}</span>
      </button>
      {open && (
        <DateTimePicker
          initial={props.value}
          withTime={withTime}
          onClose={() => setOpen(false)}
          onConfirm={(d) => { props.onChange(d); setOpen(false) }}
        />
      )}
    </>
  )
}
