import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** Cliente único do browser. A sessão fica no storage gerenciado pelo SDK. */
export function getSupabaseClient(): SupabaseClient | null {
  const config = useRuntimeConfig()
  const url = String(config.public.supabaseUrl || '')
  const key = String(config.public.supabaseKey || '')
  if (!url || !key) return null
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
