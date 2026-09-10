'use client'
import { useState } from 'react'
import type { StageKey } from '../../lib/board/stages'
import type { BoardItem } from './types'
import { STAGE_TONE } from './types'
import BoardRow from './BoardRow'

export default function StageGroup({ stage, label, items, onChanged }: { stage: StageKey; label: string; items: BoardItem[]; onChanged: () => void }) {
  // Signed deals are this month's wins — collapsed so the open work leads.
  const [open, setOpen] = useState(stage !== 'signed')
  if (items.length === 0 && stage !== 'stuck') return null
  return (
    <section className="mb-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 mb-2 px-1" aria-expanded={open}>
        <span className="font-semibold">{label}</span>
        <span className={`pill ${STAGE_TONE[stage]} num`}>{items.length}</span>
        <span className="faint text-xs">{open ? 'הסתרה' : 'הצגה'}</span>
      </button>
      {open && (
        items.length === 0
          ? <div className="text-xs faint px-1">אין דירות תקועות כרגע.</div>
          : <div className="flex flex-col gap-2">{items.map(it => <BoardRow key={it.propertyId} item={it} onChanged={onChanged} />)}</div>
      )}
    </section>
  )
}
