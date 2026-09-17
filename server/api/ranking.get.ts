import { createError } from 'h3'
import { supabaseAdmin } from '../utils/supabase'
import { isMode, type Mode } from '../utils/ordle'

export default defineEventHandler(async (event) => {
  const rawMode = getQuery(event).mode
  const mode = rawMode === undefined ? null : isMode(rawMode) ? (rawMode as Mode) : null
  if (rawMode !== undefined && !mode)
    throw createError({ statusCode: 400, statusMessage: 'invalid_mode' })

  const days = 30
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const db = supabaseAdmin(event)
  let query = db
    .from('ordle_player_games')
    .select('user_id, mode, attempts, points, game_id')
    // Também inclui a partida do dia trazida do browser: os palpites do
    // snapshot são recalculados no servidor antes de entrarem na tabela.
    .in('source', ['server', 'imported'])
    .eq('status', 'won')
    .gte('game_id', cutoff)
  if (mode) query = query.eq('mode', mode)
  const { data: games, error } = await query.limit(10_000)
  if (error) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

  const ids = [...new Set((games ?? []).map((game) => game.user_id))]
  if (!ids.length) return { days, mode, entries: [] }
  const { data: profiles, error: profileError } = await db
    .from('ordle_profiles')
    .select('user_id, public_first_name')
    .eq('leaderboard_opt_in', true)
    .in('user_id', ids)
  if (profileError) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.public_first_name]))
  const totals = new Map<string, { firstName: string; points: number; wins: number; attempts: number; played: number }>()
  for (const game of games ?? []) {
    const firstName = names.get(game.user_id)
    if (!firstName) continue
    const current = totals.get(game.user_id) ?? { firstName, points: 0, wins: 0, attempts: 0, played: 0 }
    current.points += Number(game.points) || 0
    current.wins++
    current.attempts += Number(game.attempts) || 0
    current.played++
    totals.set(game.user_id, current)
  }

  const entries = [...totals.values()]
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.wins !== a.wins) return b.wins - a.wins
      return a.attempts / a.played - b.attempts / b.played
    })
    .slice(0, 100)
    .map((entry, index) => ({
      rank: index + 1,
      firstName: entry.firstName,
      points: entry.points,
      wins: entry.wins,
      played: entry.played,
      averageAttempts: Math.round((entry.attempts / entry.played) * 100) / 100,
    }))

  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return { days, mode, entries }
})
