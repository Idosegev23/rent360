import { headers, cookies } from 'next/headers'
import ModernDashboard from '../../components/dashboard/ModernDashboard'

async function fetchDashboard(){
  const h = headers()
  const host = h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || 'http'
  const url = `${proto}://${host}/api/v1/dashboard`
  const cookieHeader = cookies().getAll().map(c=>`${c.name}=${c.value}`).join('; ')
  const res = await fetch(url, { cache: 'no-store', headers: { cookie: cookieHeader } })
  if(!res.ok) return { kpis: null, needs_attention: { failed_messages: [] } }
  return res.json()
}

export default async function DashboardPage(){
  const data = await fetchDashboard()
  return <ModernDashboard data={data} />
}
