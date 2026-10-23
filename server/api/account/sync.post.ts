import { type H3Event } from 'h3'
import { requireUser } from '../../utils/auth'
import { accountDatabase, databaseOperation } from '../../utils/database'
import {
  canonicalGame,
  ensureProfile,
  readAccountStats,
  readCloudGame,
  type AccountStats,
  type CanonicalImportedGame,
} from '../../utils/account'
import { betterImportedGame, importedGames } from '../../utils/account-sync'
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

async function importLegacyStats(event: H3Event, userId: string, snapshot: SyncSnapshot) {
  const sql = accountDatabase()
  for (const mode of MODES) {
    const stats = safeStats(snapshot.stats?.[mode], mode)
    await databaseOperation(() => sql`select ordle_import_legacy(
      ${userId}::uuid, ${snapshot.migrationId}, ${snapshot.deviceId}, ${mode},
      ${stats.played}::integer, ${stats.wins}::integer, ${stats.streak}::integer,
      ${stats.maxStreak}::integer, ${sql.array(stats.distribution)}::integer[],
      ${stats.lastGameId}::date, ${stats.lastResult},
      ${sql.json(snapshot.games?.[mode] ?? null)}, ${sql.json(snapshot.prefs ?? null)}
    )`)
  }
}

async function importGames(event: H3Event, userId: string, incoming: CanonicalImportedGame[]) {
  if (!incoming.length) return
  const sql = accountDatabase()
  for (const game of incoming) {
    await databaseOperation(() => sql.begin(async (tx) => {
      // Usa a mesma trava da gravação do servidor, inclusive quando a linha
      // ainda não existe. Um snapshot nunca sobrescreve um jogo do servidor.
      await tx`select pg_advisory_xact_lock(hashtextextended(
        ${userId + ':' + game.gameId + ':' + game.mode}, 0))`
      const [old] = await tx`select * from ordle_player_games
        where user_id = ${userId} and game_id = ${game.gameId} and mode = ${game.mode} for update`
      if (old?.source === 'server') return
      const oldCanonical = old ? canonicalGame({
        gameId: old.game_id, mode: old.mode, guesses: old.guesses, updatedAt: old.updated_at,
      }, game.mode) : null
      const chosen = oldCanonical ? betterImportedGame(oldCanonical, game) : game
      await tx`insert into ordle_player_games
        (user_id, game_id, mode, guesses, status, attempts, points, source, updated_at, completed_at)
        values (${userId}, ${chosen.gameId}, ${chosen.mode}, ${tx.json(chosen.guesses)},
          ${chosen.status}, ${chosen.attempts}, ${chosen.points}, 'imported',
          ${chosen.updatedAt}, ${chosen.completedAt})
        on conflict (user_id, game_id, mode) do update set
          guesses = excluded.guesses, status = excluded.status, attempts = excluded.attempts,
          points = excluded.points, updated_at = excluded.updated_at, completed_at = excluded.completed_at
        where ordle_player_games.source = 'imported'`
    }))
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

  const sql = accountDatabase()
  await databaseOperation(() => sql`update ordle_profiles
    set preferences = ${sql.json(snapshot.prefs)} where user_id = ${user.id}`)

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
