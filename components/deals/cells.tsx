'use client'
import { useEffect, useState } from 'react'

/** Inline-edit primitives for the deal board table. Each saves on change (select) or on blur/Enter (input). */

const base = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-brand-border focus:border-brand-primary focus:bg-white focus:outline-none disabled:cursor-default disabled:opacity-100 disabled:hover:border-transparent'

export function SelectCell({ value, options, onSave, disabled, emptyLabel = '—' }: {
  value: string | null
  options: ReadonlyArray<{ key: string; label: string }>
  onSave: (v: string | null) => void
  disabled?: boolean
  emptyLabel?: string
}) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={e => onSave(e.target.value || null)} className={`${base} min-w-[110px]`}>
      <option value="">{emptyLabel}</option>
      {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}

export function InputCell({ value, onSave, type = 'text', disabled, placeholder, dir, width = 110 }: {
  value: string | number | null
  onSave: (v: string | null) => void
  type?: 'text' | 'number' | 'date'
  disabled?: boolean
  placeholder?: string
  dir?: 'ltr' | 'rtl'
  width?: number
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  // Follow the server value when it changes underneath (reload, optimistic rollback).
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])
  const commit = () => {
    const next = draft.trim()
    if (next === (value == null ? '' : String(value))) return
    onSave(next === '' ? null : next)
  }
  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      dir={dir}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={base}
      style={{ minWidth: width }}
    />
  )
}
