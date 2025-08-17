import { createClient } from '@supabase/supabase-js'

export const supabaseBrowser = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  if(!url || !anon) throw new Error('Missing NEXT_PUBLIC_SUPABASE_* envs')
  return createClient(url, anon)
}

export const supabaseService = () => {
  const url = process.env.SUPABASE_URL as string
  const key = process.env.SUPABASE_SERVICE_ROLE as string
  if(!url || !key) throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE envs')
  return createClient(url, key)
}
