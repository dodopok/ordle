import { createError } from 'h3'
import { accountDatabase, databaseOperation } from '../utils/database'
import { isMode, type Mode } from '../utils/ordle'
import { aggregateRankingStats, type RankingStatsRow } from '../utils/ranking'

export default defineEventHandler(async (event) => {
  const rawMode = getQuery(event).mode
  const mode = rawMode === undefined ? null : isMode(rawMode) ? (rawMode as Mode) : null
  if (rawMode !== undefined && !mode)
    throw createError({ statusCode: 400, statusMessage: 'invalid_mode' })

  const sql = accountDatabase()
  const stats = await databaseOperation(() => sql`
    select s.user_id, s.mode, s.played, s.wins, s.distribution, p.public_first_name
    from ordle_stats s join ordle_profiles p on p.user_id = s.user_id
    where s.wins > 0 and p.leaderboard_opt_in = true
      ${mode ? sql`and s.mode = ${mode}` : sql``}
    limit 10000
  `)
  const profiles = stats
  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.public_first_name]))
  const rowsByUser = new Map<string, RankingStatsRow[]>()
  for (const stat of (stats ?? []) as RankingStatsRow[]) {
    const firstName = names.get(stat.user_id)
    if (!firstName) continue
    const rows = rowsByUser.get(stat.user_id) ?? []
    rows.push(stat)
    rowsByUser.set(stat.user_id, rows)
  }

  const entries = [...rowsByUser.entries()]
    .map(([userId, rows]) => {
      const aggregate = aggregateRankingStats(rows)
      return { firstName: names.get(userId)!, ...aggregate }
    })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.wins !== a.wins) return b.wins - a.wins
      return a.attempts / a.wins - b.attempts / b.wins
    })
    .slice(0, 100)
    .map((entry, index) => ({
      rank: index + 1,
      firstName: entry.firstName,
      points: entry.points,
      wins: entry.wins,
      played: entry.played,
      averageAttempts: Math.round((entry.attempts / entry.wins) * 100) / 100,
    }))

  setHeader(event, 'Cache-Control', 'no-store')
  return { mode, entries }
})
