'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircle } from 'lucide-react'

/** Quick link to the property's WhatsApp conversation (the landlord thread auto-linked by property_id).
 *  Shows nothing if there's no conversation yet. */
export default function PropertyConversationLink({ propertyId }: { propertyId: string }) {
  const [threadId, setThreadId] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/v1/inbox/threads?propertyId=${propertyId}`).then(r => r.json())
      .then(d => { const t = (d.threads || [])[0]; if (t?.id) setThreadId(t.id) })
      .catch(() => {})
  }, [propertyId])
  if (!threadId) return null
  return (
    <Link href={`/inbox/${threadId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-primary hover:bg-brand-primary/5">
      <MessageCircle className="h-4 w-4" /> פתח שיחת וואטסאפ
    </Link>
  )
}
