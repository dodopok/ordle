import { ensureProfile, sanitizeFirstName } from '../../utils/account'
import { requireUser, supabaseAdmin } from '../../utils/supabase'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ publicFirstName?: unknown; leaderboardOptIn?: unknown }>(event)
  const profile = await ensureProfile(event, user)
  const updates: Record<string, unknown> = {}

  if (body?.publicFirstName !== undefined) updates.public_first_name = sanitizeFirstName(body.publicFirstName)
  if (body?.leaderboardOptIn !== undefined) {
    if (typeof body.leaderboardOptIn !== 'boolean')
      throw createError({ statusCode: 400, statusMessage: 'invalid_leaderboard_choice' })
    updates.leaderboard_opt_in = body.leaderboardOptIn
  }
  if (!Object.keys(updates).length) return { profile }

  const db = supabaseAdmin(event)
  const { data, error } = await db
    .from('ordle_profiles')
    .update(updates)
    .eq('user_id', user.id)
    .select('user_id, public_first_name, leaderboard_opt_in')
    .single()
  if (error || !data) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })
  return {
    profile: {
      userId: data.user_id,
      publicFirstName: data.public_first_name,
      leaderboardOptIn: !!data.leaderboard_opt_in,
    },
  }
})
