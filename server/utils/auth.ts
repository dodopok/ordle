import { createError, type H3Event } from 'h3'

export type AccountUser = { id: string; firstName: string }

export async function optionalUser(event: H3Event): Promise<AccountUser | null> {
  if (!useRuntimeConfig(event).public.accountsEnabled) return null
  const session = await getUserSession(event)
  return session.user ?? null
}

export async function requireUser(event: H3Event): Promise<AccountUser> {
  const user = await optionalUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'login_required' })
  return user
}
