'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Topbar from '../../components/shell/Topbar'
import TargetsBar from '../../components/board/TargetsBar'
import OrphansStrip from '../../components/board/OrphansStrip'
import StageGroup from '../../components/board/StageGroup'
import type { BoardData } from '../../components/board/types'

export default function BoardPage() {
  // null = the server's default (the viewer when they handle properties, else the first agent).
  // Set only by the selector, so the first load fetches once.
  const [agent, setAgent] = useState<string | null>(null)
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Each load gets a sequence number; only the newest may write state. A fast agent switch can
  // otherwise land an older agent's response last and show it under the newer selection.
  const reqSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setError(null)
    try {
      const r = await fetch(`/api/v1/board${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`)
      if (!r.ok) throw new Error(String(r.status))
      const d = (await r.json()) as BoardData
      if (seq !== reqSeq.current) return
      setData(d)
    } catch {
      if (seq === reqSeq.current) setError('טעינת הלוח נכשלה. אפשר לרענן את העמוד.')
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [agent])

  useEffect(() => { setLoading(true); void load() }, [load])

  // The payload says which agent it describes — the default may not be the viewer.
  const selectedAgent = agent ?? data?.agentId ?? ''
  const openCount = data ? data.groups.filter(g => g.stage !== 'signed').reduce((s, g) => s + g.items.length, 0) : 0

  return (
    <>
      <Topbar crumb="בית · לוח בקרה" title="לוח בקרה" />
      <div className="page-wrap">
        {data && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm flex items-center gap-2">
              <span className="faint">הלוח של</span>
              <select value={selectedAgent} onChange={e => setAgent(e.target.value)} className="border rounded px-2 py-1 text-sm">
                {data.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <span className="text-sm faint num">{openCount} דירות פתוחות</span>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-brand-primary" aria-label="טוען" />}
          </div>
        )}
        {loading && !data ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-primary" /></div>
        ) : error ? (
          <div className="surface-card text-sm" style={{ padding: 16 }}>{error}</div>
        ) : data ? (
          <>
            {/* Keyed and addressed by the payload's agent, never the selector — see BoardData.agentId. */}
            <TargetsBar key={`${data.agentId}-${data.targets.month}`} targets={data.targets} userId={data.agentId} onSaved={() => void load()} />
            <OrphansStrip orphans={data.orphans} agents={data.agents} meId={data.me.id} onChanged={() => void load()} />
            {data.groups.map(g => (
              <StageGroup key={g.stage} stage={g.stage} label={g.label} items={g.items} onChanged={() => void load()} />
            ))}
            {openCount === 0 && <div className="text-sm faint text-center py-8">אין דירות פתוחות בלוח הזה.</div>}
          </>
        ) : null}
      </div>
    </>
  )
}
