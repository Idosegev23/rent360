/**
 * Role → capability model. Pure (no server imports) so the same table drives both the API guards
 * and the sidebar/UI. To widen or narrow access: change a role's list here, or store a per-user
 * override in `users.permissions` ({ grant: [...], deny: [...] }) — no schema change needed.
 *
 * Deliberately small: only what the roles actually differ on. Everything else (properties pool,
 * tasks, meetings, inbox, renters, board) stays open to every staff role, as before.
 */

export const CAPABILITIES = [
  'team.manage',          // add / edit / deactivate staff, change roles
  'targets.manage',       // set agents' monthly targets
  'commissions.view_all', // see every deal's commission, not just one's own
  'commissions.manage',   // mark collected, edit amounts, define split rules
  'reports.view',         // office KPIs
  'company.dashboard',    // company-wide targets / department breakdown
  'outreach.send',        // outreach, renewals, send logs
  'settings.admin',       // bot interview editor and other org settings
] as const

export type Capability = typeof CAPABILITIES[number]

export const ROLES = ['owner', 'admin', 'agent', 'office', 'marketing', 'viewer'] as const
export type Role = typeof ROLES[number]

/** Hebrew, gender-neutral labels for the team screen. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'בעלים',
  admin: 'הנהלה',
  agent: 'יועצי נדל״ן',
  office: 'משרד',
  marketing: 'שיווק',
  viewer: 'צפייה בלבד',
}

const ALL: readonly Capability[] = CAPABILITIES

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ALL,
  admin: ALL,
  agent: ['outreach.send'],
  office: ['outreach.send'],
  marketing: ['outreach.send', 'reports.view'],
  viewer: [],
}

export type PermissionOverrides = { grant?: unknown; deny?: unknown } | null | undefined

const isCapability = (v: unknown): v is Capability => typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v)
const caps = (v: unknown): Capability[] => (Array.isArray(v) ? v.filter(isCapability) : [])

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
}

/** Effective capabilities = role defaults + grants − denials. Unknown/missing role → no capabilities. */
export function capabilitiesFor(role: string | null | undefined, overrides?: PermissionOverrides): Capability[] {
  const set = new Set<Capability>(isRole(role) ? ROLE_CAPABILITIES[role] : [])
  for (const c of caps(overrides?.grant)) set.add(c)
  for (const c of caps(overrides?.deny)) set.delete(c)
  return Array.from(set)
}

export function hasCapability(role: string | null | undefined, cap: Capability, overrides?: PermissionOverrides): boolean {
  return capabilitiesFor(role, overrides).includes(cap)
}
