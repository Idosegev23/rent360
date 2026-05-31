import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = new Set<string>([
  '/auth/login',
  '/auth/change-password',
  '/api/v1/health',
  '/api/v1/auth/seed',
])

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // Public renter form (any path under /r/...) + public renter APIs (token validation + submit).
  // These are unauthenticated by design — renters arrive via a WhatsApp link.
  // The neighborhoods lookup is also public — it powers the autocomplete in the
  // public questionnaire and exposes only city/neighborhood pairs from active
  // properties, no PII.
  const isPublicRenter =
    pathname.startsWith('/r/') ||
    pathname === '/api/v1/renters/submit' ||
    pathname === '/api/v1/neighborhoods' ||
    /^\/api\/v1\/renters\/invite\/[^/]+$/.test(pathname)

  // Cron-authenticated endpoints — they verify Authorization: Bearer <CRON_SECRET> themselves.
  // Without this allowlist Vercel Cron / curl can't reach them through the session middleware.
  const isCronAuthed =
    pathname === '/api/v1/matches/backfill' ||
    pathname === '/api/v1/neighborhoods/backfill' ||
    pathname === '/api/v1/properties/audit-amenities' ||
    pathname === '/api/v1/outreach/batch-pending'

  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/v1/integrations') ||
    isPublicRenter ||
    isCronAuthed
  ) {
    return NextResponse.next()
  }

  // Supabase sets sb-access-token cookie on client auth
  const accessToken = req.cookies.get('sb-access-token')?.value || req.cookies.get('supabase-auth-token')?.value
  if (!accessToken) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

