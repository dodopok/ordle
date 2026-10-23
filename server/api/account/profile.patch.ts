import { ensureProfile, sanitizeFirstName } from '../../utils/account'
import { requireUser } from '../../utils/auth'
import { accountDatabase, databaseOperation } from '../../utils/database'

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

  const sql = accountDatabase()
  const [data] = await databaseOperation(() => sql`
    update ordle_profiles set ${sql(updates)} where user_id = ${user.id}
    returning user_id, public_first_name, leaderboard_opt_in
  `)
  if (!data) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })
  return {
    profile: {
      userId: data.user_id,
      publicFirstName: data.public_first_name,
      leaderboardOptIn: !!data.leaderboard_opt_in,
    },
  }
})
