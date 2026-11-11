'use client'
import { useEffect, useState } from 'react'
import type { Capability } from '../auth/permissions'

export type Me = {
  id: string
  name: string | null
  email: string | null
  role: string | null
  title: string | null
  capabilities: Capability[]
  google: { connected: boolean; email: string | null }
}

// One /api/me request per page load, shared by every component that asks.
let inflight: Promise<Me | null> | null = null
function loadMe(): Promise<Me | null> {
  if (!inflight) {
    inflight = fetch('/api/me')
      .then(r => (r.ok ? (r.json() as Promise<Me>) : null))
      .catch(() => null)
  }
  return inflight
}

/** `me` is undefined while loading, null when signed out / the request failed. */
export function useMe(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  useEffect(() => { let on = true; loadMe().then(m => { if (on) setMe(m) }); return () => { on = false } }, [])
  return me
}

/** true / false once loaded, undefined while loading. Missing `capabilities` (older API) reads as false. */
export function useCan(cap: Capability): boolean | undefined {
  const me = useMe()
  if (me === undefined) return undefined
  return !!me?.capabilities?.includes(cap)
}
