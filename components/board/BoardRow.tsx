'use client'
import { useState } from 'react'
import Link from 'next/link'
import { MANUAL_STAGE_KEYS, stageLabel, type StageKey } from '../../lib/board/stages'
import type { BoardItem } from './types'
import { STAGE_TONE, fmtShortDate } from './types'

function DaysPill({ days }: { days: number }) {
  const tone = days >= 14 ? 'pill-red' : days >= 7 ? 'pill-amber' : 'pill-gray'
  return <span className={`pill ${tone} num`} title="ימים בשלב הנוכחי">{days} ימים</span>
}

export default function BoardRow({ item, onChanged }: { item: BoardItem; onChanged: () => void }) {
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const noteDirty = noteDraft.trim() !== (item.note ?? '')

  async function post(payload: { stage?: StageKey; note?: string }) {
    setBusy(true); setErr(null)
    const r = await fetch('/api/v1/board/stage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: item.propertyId, ...payload }),
    }).catch(() => null)
    setBusy(false)
    if (!r || !r.ok) { setErr('העדכון נכשל. אפשר לנסות שוב.'); return }
    onChanged()
  }

  return (
    <div className="surface-card" style={{ padding: 12 }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div style={{ minWidth: 0 }}>
          <Link href={`/properties/${item.propertyId}`} className="font-semibold text-sm no-underline" style={{ color: 'var(--ink)' }}>{item.label}</Link>
          <div className="text-xs faint">
            {item.ownerName || 'ללא שם'}
            {item.ownerPhone && <> · <a href={`tel:${item.ownerPhone}`} className="num">{item.ownerPhone}</a></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DaysPill days={item.daysInStage} />
          {item.stage === 'signed' ? (
            <span className={`pill ${STAGE_TONE.signed}`}>{stageLabel('signed')}</span>
          ) : (
            <select
              aria-label="שלב"
              value={item.stage}
              disabled={busy}
              onChange={e => void post({ stage: e.target.value as StageKey })}
              className="border rounded px-2 py-1 text-sm"
            >
              {MANUAL_STAGE_KEYS.map(k => <option key={k} value={k}>{stageLabel(k)}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        <span>
          <span className="faint">משימה הבאה: </span>
          {item.nextTask
            ? <Link href="/tasks">{item.nextTask.title}{item.nextTask.dueAt && <span className="faint num"> · {fmtShortDate(item.nextTask.dueAt)}</span>}</Link>
            : <span className="faint">אין</span>}
        </span>
        <span>
          <span className="faint">פגישה קרובה: </span>
          {item.nextMeeting
            ? <Link href="/meetings">{item.nextMeeting.title}<span className="faint num"> · {fmtShortDate(item.nextMeeting.startsAt)}</span></Link>
            : <span className="faint">אין</span>}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <input
          aria-label="הערה"
          value={noteDraft}
          onChange={e => setNoteDraft(e.target.value)}
          placeholder="הערה — למשל: ממתין לצ׳קים מהשוכר"
          className="flex-1 border rounded px-2 py-1 text-sm"
          maxLength={2000}
        />
        {noteDirty && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void post({ note: noteDraft })}>שמירה</button>}
      </div>
      {(item.updatedBy || err) && (
        <div className="text-xs mt-1">
          {err ? <span style={{ color: 'var(--red, #dc2626)' }}>{err}</span>
               : <span className="faint">עדכון אחרון: {item.updatedBy}{item.updatedAt && ` · ${fmtShortDate(item.updatedAt)}`}</span>}
        </div>
      )}
    </div>
  )
}
