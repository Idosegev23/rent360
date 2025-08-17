import { headers, cookies } from 'next/headers'
import ModernLeadsPage from '../../components/leads/ModernLeadsPage'

async function fetchLeads() {
  const h = headers()
  const host = h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || 'http'
  const url = `${proto}://${host}/api/v1/leads`
  const cookieHeader = cookies().getAll().map(c=>`${c.name}=${c.value}`).join('; ')
  
  try {
    const res = await fetch(url, { 
      cache: 'no-store', 
      headers: { cookie: cookieHeader } 
    })
    if (!res.ok) return []
    return res.json()
  } catch (error) {
    console.error('Failed to fetch leads:', error)
    return []
  }
}

export default async function LeadsPage() {
  const leads = await fetchLeads()
  return <ModernLeadsPage leads={leads} />
}
