/**
 * Auto-save a serializable form snapshot to localStorage on a 5-second interval.
 *
 * - Saves only when the snapshot actually changes (no-op writes are skipped).
 * - Exposes `loadDraft()` + `clearDraft()` for restore-on-mount + clear-on-submit.
 * - File objects (e.g. images) are NOT serializable — keep them out of `state`
 *   and re-attach manually after restore. The hook stores a `_savedAt` field
 *   automatically so the UI can show "נשמרה לפני X שניות".
 */

import { useEffect, useRef, useState } from 'react'

const PREFIX = 'rent360:draft:'

export type DraftMeta = { _savedAt: number }

export function loadDraft<T>(key: string): (T & DraftMeta) | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as T & DraftMeta
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(PREFIX + key) } catch {}
}

export function useDraftAutosave<T>(key: string, state: T, intervalMs: number = 5000): { savedAt: number | null } {
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const lastJsonRef = useRef<string>('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => {
      try {
        const json = JSON.stringify(state)
        if (json === lastJsonRef.current) return
        const wrapped = { ...(JSON.parse(json) as object), _savedAt: Date.now() }
        window.localStorage.setItem(PREFIX + key, JSON.stringify(wrapped))
        lastJsonRef.current = json
        setSavedAt(wrapped._savedAt)
      } catch {/* quota / serialization errors — fail silent */}
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [key, state, intervalMs])

  return { savedAt }
}
