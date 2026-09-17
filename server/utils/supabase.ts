import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createError, getHeader, type H3Event } from 'h3'

function configFor(event: H3Event) {
  const config = useRuntimeConfig(event)
  const url = String(config.public.supabaseUrl || '')
  const publishableKey = String(config.public.supabaseKey || '')
  const serviceRoleKey = String(config.supabaseServiceRoleKey || '')
  if (!url || !publishableKey || !serviceRoleKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'account_not_configured',
    })
  }
  return { url, publishableKey, serviceRoleKey }
}

export function supabaseAdmin(event: H3Event): SupabaseClient {
  const { url, serviceRoleKey } = configFor(event)
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function authClient(event: H3Event): Promise<SupabaseClient | null> {
  const authorization = getHeader(event, 'authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const { url, publishableKey } = configFor(event)
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export async function optionalUser(event: H3Event): Promise<User | null> {
  const client = await authClient(event)
  if (!client) return null
  const { data, error } = await client.auth.getUser()
  return error ? null : data.user
}

export async function requireUser(event: H3Event): Promise<User> {
  const authorization = getHeader(event, 'authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'login_required' })
  }
  const client = await authClient(event)
  const { data, error } = await client!.auth.getUser()
  if (error || !data.user) throw createError({ statusCode: 401, statusMessage: 'invalid_session' })
  return data.user
}
