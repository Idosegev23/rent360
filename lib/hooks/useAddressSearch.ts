/**
 * Israeli address autocomplete via OpenStreetMap Nominatim.
 *
 * Free, no API key, no signup. Public usage limit is ~1 req/sec — we debounce
 * to 350ms keystrokes and only search when ≥3 chars are typed. For a single
 * user typing in a form this is well within limits.
 *
 * If we ever hit limits, we can either self-host Nominatim or move to Photon.
 */

import { useEffect, useRef, useState } from 'react'

export type AddressSuggestion = {
  display_name: string
  street: string | null
  housenumber: string | null
  neighbourhood: string | null
  city: string | null
  lat: string
  lon: string
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'

export function useAddressSearch(query: string, opts?: { minChars?: number; debounceMs?: number }) {
  const minChars = opts?.minChars ?? 3
  const debounceMs = opts?.debounceMs ?? 350
  const [results, setResults] = useState<AddressSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < minChars) {
      setResults([])
      setLoading(false)
      return
    }

    const myId = ++reqId.current
    setLoading(true)

    const t = setTimeout(async () => {
      try {
        const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(trimmed)}&format=json&countrycodes=il&addressdetails=1&limit=6&accept-language=he`
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (myId !== reqId.current) return // stale
        const data = await res.json() as Array<any>
        const mapped: AddressSuggestion[] = (data || []).map(d => ({
          display_name: d.display_name,
          street: d.address?.road || d.address?.pedestrian || null,
          housenumber: d.address?.house_number || null,
          neighbourhood: d.address?.neighbourhood || d.address?.suburb || null,
          city: d.address?.city || d.address?.town || d.address?.village || d.address?.municipality || null,
          lat: d.lat,
          lon: d.lon,
        }))
        setResults(mapped)
      } catch {
        if (myId === reqId.current) setResults([])
      } finally {
        if (myId === reqId.current) setLoading(false)
      }
    }, debounceMs)

    return () => clearTimeout(t)
  }, [query, minChars, debounceMs])

  return { results, loading }
}
