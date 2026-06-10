import { supabaseService } from '@/lib/supabase'

export type ActivityEntity = 'property' | 'renter' | 'thread' | 'tenancy' | 'task' | 'meeting' | 'contact'
export type ActivityKind =
  | 'note' | 'call' | 'whatsapp' | 'email' | 'status_change' | 'task' | 'meeting' | 'system'

/**
 * Append an entry to an entity's timeline. Best-effort — never throws (a logging failure must
 * not break the mutation that triggered it). `authorUserId` null = system-generated.
 */
export async function logActivity(args: {
  orgId: string
  entityType: ActivityEntity
  entityId: string
  kind: ActivityKind
  body?: string | null
  metadata?: Record<string, unknown> | null
  authorUserId?: string | null
}): Promise<void> {
  try {
    await supabaseService().from('activity').insert({
      org_id: args.orgId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      author_user_id: args.authorUserId ?? null,
      kind: args.kind,
      body: args.body ?? null,
      metadata: args.metadata ?? null,
    })
  } catch {
    /* best-effort */
  }
}
