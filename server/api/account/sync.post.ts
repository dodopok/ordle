import { type H3Event } from 'h3'
import { requireUser, supabaseAdmin } from '../../utils/supabase'
import {
  canonicalGame,
  ensureProfile,
  readAccountStats,
  readCloudGame,
  type AccountStats,
  type CanonicalImportedGame,
} from '../../utils/account'
import {
  answerForGameId,
  gameId,
  gameNumber,
  grade,
  isMode,
  MAX_ATTEMPTS,
  timestampForGameId,
  type Mode,
} from '../../utils/ordle'
import type { SyncSnapshot } from '../../../app/composables/useOrdleStorage'

const MODES: Mode[] = ['normal', 'hard']

type SafeStats = AccountStats

function integer(value: unknown, fallback = 0, max = 100_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.trunc(value)))
}

function safeStats(value: unknown, mode: Mode): SafeStats {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const played = integer(raw.played)
  const wins = Math.min(played, integer(raw.wins))
  const distribution = Array.from({ length: MAX_ATTEMPTS[mode] }, (_, i) =>
    integer(Array.isArray(raw.distribution) ? raw.distribution[i] : 0),
  )
  const lastGameId =
    typeof raw.lastGameId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastGameId)
      ? raw.lastGameId
      : null
  const lastResult = raw.lastResult === 'won' || raw.lastResult === 'lost' ? raw.lastResult : null
  return {
    v: 1,
    played,
    wins,
    streak: integer(raw.streak),
    maxStreak: integer(raw.maxStreak),
    distribution,
    lastGameId,
    lastResult,
  }
}

function safeMigrationId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 120)
    throw createError({ statusCode: 400, statusMessage: 'invalid_migration' })
  return value
}

function safeDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 120)
    throw createError({ statusCode: 400, statusMessage: 'invalid_device' })
  return value
}

function terminal(status: string): boolean {
  return status === 'won' || status === 'lost'
}

function betterImportedGame(a: CanonicalImportedGame, b: CanonicalImportedGame): CanonicalImportedGame {
  if (terminal(a.status) !== terminal(b.status)) return terminal(a.status) ? a : b
  if (a.status !== b.status) return a.status === 'won' ? a : b
  if (a.status !== 'playing' && a.attempts !== b.attempts) return a.attempts < b.attempts ? a : b
  return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b
}

function importedGames(snapshot: SyncSnapshot): CanonicalImportedGame[] {
  const byKey = new Map<string, CanonicalImportedGame>()
  for (const mode of MODES) {
    const values = [
      ...(Array.isArray(snapshot.history?.[mode]) ? snapshot.history[mode] : []),
      snapshot.games?.[mode],
    ]
    for (const value of values) {
      const game = canonicalGame(value, mode)
      if (!game) continue
      const key = `${game.mode}:${game.gameId}`
      const previous = byKey.get(key)
      byKey.set(key, previous ? betterImportedGame(previous, game) : game)
    }
  }
  return [...byKey.values()]
}

async function importLegacyStats(event: H3Event, userId: string, snapshot: SyncSnapshot) {
  const db = supabaseAdmin(event)
  for (const mode of MODES) {
    const stats = safeStats(snapshot.stats?.[mode], mode)
    const { error } = await db.rpc('ordle_import_legacy', {
      p_user_id: userId,
      p_migration_id: snapshot.migrationId,
      p_device_id: snapshot.deviceId,
      p_mode: mode,
      p_played: stats.played,
      p_wins: stats.wins,
      p_streak: stats.streak,
      p_max_streak: stats.maxStreak,
      p_distribution: stats.distribution,
      p_last_game_id: stats.lastGameId,
      p_last_result: stats.lastResult,
      p_game_snapshot: snapshot.games?.[mode] ?? null,
      p_preferences_snapshot: snapshot.prefs ?? null,
    })
    if (error) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })
  }
}

async function importGames(event: H3Event, userId: string, incoming: CanonicalImportedGame[]) {
  if (!incoming.length) return
  const db = supabaseAdmin(event)
  const gameIds = [...new Set(incoming.map((game) => game.gameId))]
  const { data: existingRows, error } = await db
    .from('ordle_player_games')
    .select('user_id, game_id, mode, guesses, status, attempts, points, source, updated_at, completed_at')
    .eq('user_id', userId)
    .in('game_id', gameIds)
  if (error) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

  const existing = new Map(
    (existingRows ?? []).map((row) => [`${row.mode}:${row.game_id}`, row]),
  )
  for (const game of incoming) {
    const old = existing.get(`${game.mode}:${game.gameId}`) as Record<string, unknown> | undefined
    // Uma partida capturada pelo servidor é a autoridade; o snapshot local
    // só preenche lacunas legadas e nunca rebaixa um resultado server-side.
    if (old?.source === 'server') continue
    const oldCanonical = old
      ? canonicalGame(
          {
            gameId: old.game_id,
            mode: old.mode,
            guesses: old.guesses,
            updatedAt: old.updated_at,
          },
          game.mode,
        )
      : null
    const chosen = oldCanonical ? betterImportedGame(oldCanonical, game) : game
    const { error: writeError } = await db.from('ordle_player_games').upsert(
      {
        user_id: userId,
        game_id: chosen.gameId,
        mode: chosen.mode,
        guesses: chosen.guesses,
        status: chosen.status,
        attempts: chosen.attempts,
        points: chosen.points,
        source: 'imported',
        updated_at: chosen.updatedAt,
        completed_at: chosen.completedAt,
      },
      { onConflict: 'user_id,game_id,mode' },
    )
    if (writeError) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })
  }
}

function responseGame(row: Awaited<ReturnType<typeof readCloudGame>>) {
  if (!row) return null
  const answer = answerForGameId(row.game_id, row.mode)!
  const timestamp = timestampForGameId(row.game_id)!
  return {
    gameId: row.game_id,
    gameNumber: gameNumber(timestamp),
    mode: row.mode,
    wordLength: answer.key.length,
    guesses: row.guesses,
    results: row.guesses.map((guess) => grade(guess, answer.key)),
    status: row.status,
    ...(row.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
}

function normalizeSnapshot(body: unknown): SyncSnapshot {
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'invalid_snapshot' })
  const raw = body as Partial<SyncSnapshot>
  const migrationId = safeMigrationId(raw.migrationId)
  const deviceId = safeDeviceId(raw.deviceId)
  return {
    v: 1,
    migrationId,
    deviceId,
    stats: {
      normal: safeStats(raw.stats?.normal, 'normal') as SyncSnapshot['stats']['normal'],
      hard: safeStats(raw.stats?.hard, 'hard') as SyncSnapshot['stats']['hard'],
    },
    games: {
      normal: raw.games?.normal ?? null,
      hard: raw.games?.hard ?? null,
    },
    history: {
      normal: Array.isArray(raw.history?.normal) ? raw.history.normal.slice(-400) : [],
      hard: Array.isArray(raw.history?.hard) ? raw.history.hard.slice(-400) : [],
    },
    prefs: raw.prefs && typeof raw.prefs === 'object' ? (raw.prefs as SyncSnapshot['prefs']) : {
      v: 1,
      theme: 'system',
      highContrast: false,
      sound: true,
      mode: 'normal',
    },
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const snapshot = normalizeSnapshot(await readBody(event))
  const profile = await ensureProfile(event, user)
  await importLegacyStats(event, user.id, snapshot)
  await importGames(event, user.id, importedGames(snapshot))

  const db = supabaseAdmin(event)
  const { error: preferencesError } = await db
    .from('ordle_profiles')
    .update({ preferences: snapshot.prefs })
    .eq('user_id', user.id)
  if (preferencesError) throw createError({ statusCode: 503, statusMessage: 'account_database_error' })

  const currentId = gameId()
  const games = {} as SyncSnapshot['games']
  const stats = {} as SyncSnapshot['stats']
  for (const mode of MODES) {
    const row = await readCloudGame(event, user.id, currentId, mode)
    games[mode] = responseGame(row) as SyncSnapshot['games'][typeof mode]
    stats[mode] = (await readAccountStats(event, user.id, mode)) as SyncSnapshot['stats'][typeof mode]
  }

  return { profile, stats, games }
})
