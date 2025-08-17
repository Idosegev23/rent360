import { cookies } from 'next/headers'
import { supabaseService } from '../../lib/supabase'
import { getUserIdFromSupabaseCookie } from '../../lib/auth'
import ModernPropertiesPage from '../../components/properties/ModernPropertiesPage'

async function fetchProperties(){
  const cookie = cookies().get('sb-access-token')?.value
  const uid = getUserIdFromSupabaseCookie(cookie)
  if(!uid) return []
  const sb = supabaseService()
  const { data: user } = await sb.from('users').select('org_id').eq('id', uid).maybeSingle()
  if(!user) return []
  const { data } = await sb
    .from('properties')
    .select('*')
    .eq('org_id', user.org_id)
    .order('created_at', { ascending: false })
    .limit(200)
  return data || []
}

export default async function PropertiesPage(){
  const properties = await fetchProperties()
  return <ModernPropertiesPage properties={properties} />
}
