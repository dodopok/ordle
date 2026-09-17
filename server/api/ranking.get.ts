import { createError } from 'h3'
import { supabaseAdmin } from '../utils/supabase'
import { isMode, type Mode } from '../utils/ordle'
import { aggregateRankingStats, type RankingStatsRow } from '../utils/ranking'

export default defineEventHandler(async (event) => {
  const rawMode = getQuery(event).mode
  const mode = rawMode === undefined ? null : isMode(rawMode) ? (rawMode as Mode) : null
  if (rawMode !== undefined && !mode)
    throw createError({ statusCode: 400, statusMessage: 'invalid_mode' })

  const db = supabaseAdmin(event)
  let query = db
    .from('ordle_stats')
    .select('user_id, mode, played, wins, distribution')
    .gt('wins', 0)
  if (mode) query = query.eq('mode', mode)
  const { data: stats, error } = await query.limit(10_000)
  if (error) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

  const ids = [...new Set((stats ?? []).map((stat) => stat.user_id))]
  if (!ids.length) return { mode, entries: [] }
  const { data: profiles, error: profileError } = await db
    .from('ordle_profiles')
    .select('user_id, public_first_name')
    .eq('leaderboard_opt_in', true)
    .in('user_id', ids)
  if (profileError) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

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
