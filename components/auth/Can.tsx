'use client'
import type { ReactNode } from 'react'
import type { Capability } from '../../lib/auth/permissions'
import { useCan } from '../../lib/hooks/useMe'

/** Renders children only for staff with `cap`. Renders nothing while the session is still loading. */
export default function Can({ cap, children }: { cap: Capability; children: ReactNode }) {
  return useCan(cap) ? <>{children}</> : null
}
