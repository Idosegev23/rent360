import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = new Set<string>([
  '/auth/login',
  '/auth/change-password',
  '/api/v1/health',
  '/api/v1/auth/seed',
])

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/v1/integrations')
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

