export function getOrgIdFromAuthHeader(auth?: string): string | null {
  if(!auth) return null
  if(auth.startsWith('Bearer ')){
    const token = auth.slice(7)
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'))
      const org = payload?.org_id || payload?.orgId || null
      return org ?? null
    } catch {
      return null
    }
  }
  return null
}

export function getUserIdFromSupabaseCookie(cookieValue?: string | null): string | null {
  if(!cookieValue) return null
  try {
    const payload = JSON.parse(Buffer.from(cookieValue.split('.')[1] || '', 'base64').toString('utf8'))
    const sub = payload?.sub || null
    return sub ?? null
  } catch {
    return null
  }
}
