import type { AccountUser } from './auth'
import { createError, type H3Event } from 'h3'
import {
  answerForGameId,
  gameId,
  grade,
  gameNumber,
  isMode,
  MAX_ATTEMPTS,
  normalize,
  timestampForGameId,
  type Mode,
} from './ordle'
import { accountDatabase, databaseOperation } from './database'

type GameStatus = 'playing' | 'won' | 'lost'

export type CloudGameRow = {
  user_id: string
  game_id: string
  mode: Mode
  guesses: string[]
  status: GameStatus
  attempts: number
  points: number
  source: 'server' | 'imported'
  updated_at: string
  completed_at: string | null
}

export type AccountStats = {
  v: 1
  played: number
  wins: number
  streak: number
  maxStreak: number
  distribution: number[]
  lastGameId: string | null
  lastResult: Exclude<GameStatus, 'playing'> | null
}

export type AccountProfile = {
  userId: string
  publicFirstName: string
  leaderboardOptIn: boolean
}

export const emptyAccountStats = (mode: Mode): AccountStats => ({
  v: 1,
  played: 0,
  wins: 0,
  streak: 0,
  maxStreak: 0,
  distribution: Array(MAX_ATTEMPTS[mode]).fill(0),
  lastGameId: null,
  lastResult: null,
})

export function scoreFor(mode: Mode, status: GameStatus, attempts: number): number {
  return status === 'won' ? Math.max(0, MAX_ATTEMPTS[mode] + 1 - attempts) : 0
}

export function sanitizeFirstName(value: unknown): string {
  if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: 'invalid_name' })
  const name = value.trim().replace(/\s+/g, ' ').split(' ')[0] ?? ''
  if (!name || name.length > 32 || /[<>]/.test(name))
    throw createError({ statusCode: 400, statusMessage: 'invalid_name' })
  return name
}

export async function ensureProfile(event: H3Event, user: AccountUser): Promise<AccountProfile> {
  const sql = accountDatabase()
  const data = await databaseOperation(async () => {
    await sql`insert into ordle_profiles (user_id, public_first_name)
      values (${user.id}, ${user.firstName}) on conflict (user_id) do nothing`
    const [row] = await sql`select user_id, public_first_name, leaderboard_opt_in
      from ordle_profiles where user_id = ${user.id}`
    return row!
  })
  return {
    userId: data.user_id,
    publicFirstName: data.public_first_name,
    leaderboardOptIn: !!data.leaderboard_opt_in,
  }
}

export async function readCloudGame(
  event: H3Event,
  userId: string,
  gameId: string,
  mode: Mode,
): Promise<CloudGameRow | null> {
  const sql = accountDatabase()
  const [row] = await databaseOperation(() => sql<CloudGameRow[]>`
    select user_id, game_id, mode, guesses, status, attempts, points, source, updated_at, completed_at
    from ordle_player_games where user_id = ${userId} and game_id = ${gameId} and mode = ${mode}
  `)
  return row ?? null
}

export async function readAccountStats(event: H3Event, userId: string, mode: Mode): Promise<AccountStats> {
  const sql = accountDatabase()
  const [data] = await databaseOperation(() => sql`
    select played, wins, streak, max_streak, distribution, last_game_id, last_result
    from ordle_stats where user_id = ${userId} and mode = ${mode}
  `)
  if (!data) return emptyAccountStats(mode)
  return {
    v: 1,
    played: Number(data.played) || 0,
    wins: Number(data.wins) || 0,
    streak: Number(data.streak) || 0,
    maxStreak: Number(data.max_streak) || 0,
    distribution: Array.from({ length: MAX_ATTEMPTS[mode] }, (_, i) => Number(data.distribution?.[i]) || 0),
    lastGameId: data.last_game_id ?? null,
    lastResult: data.last_result === 'won' || data.last_result === 'lost' ? data.last_result : null,
  }
}

export function parseMode(value: unknown): Mode {
  if (!isMode(value)) throw createError({ statusCode: 400, statusMessage: 'invalid_mode' })
  return value
}

export type CanonicalImportedGame = {
  gameId: string
  mode: Mode
  guesses: string[]
  status: Exclude<GameStatus, 'playing'> | 'playing'
  attempts: number
  points: number
  updatedAt: string
  completedAt: string | null
}

/** Recalcula o resultado a partir da resposta do dia; nunca aceita answer/status do client. */
export function canonicalGame(input: unknown, fallbackMode: Mode): CanonicalImportedGame | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const gameId = typeof raw.gameId === 'string' ? raw.gameId : ''
  const mode = raw.mode === undefined ? fallbackMode : raw.mode
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameId) || !isMode(mode)) return null
  const timestamp = timestampForGameId(gameId)
  const answer = answerForGameId(gameId, mode)
  if (timestamp === null || !answer || gameNumber(timestamp) < 1 || gameId > currentGameId()) return null
  const rawGuesses = Array.isArray(raw.guesses) ? raw.guesses : []
  if (rawGuesses.length > MAX_ATTEMPTS[mode]) return null
  const guesses = rawGuesses.map((guess) => (typeof guess === 'string' ? normalize(guess) : ''))
  if (guesses.some((guess) => !guess || guess.length !== answer.key.length || !/^[A-Z]+$/.test(guess))) return null
  const wonAt = guesses.findIndex((guess) => guess === answer.key)
  if (wonAt >= 0 && wonAt !== guesses.length - 1) return null
  const status: GameStatus = wonAt >= 0 ? 'won' : guesses.length >= MAX_ATTEMPTS[mode] ? 'lost' : 'playing'
  const updatedAt =
    typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : new Date().toISOString()
  return {
    gameId,
    mode,
    guesses,
    status,
    attempts: guesses.length,
    points: scoreFor(mode, status, guesses.length),
    updatedAt,
    completedAt: status === 'playing' ? null : updatedAt,
  }
}

export function currentGameId(): string {
  return gameId()
}

export function gameResponse(row: CloudGameRow) {
  const timestamp = timestampForGameId(row.game_id)!
  const answer = answerForGameId(row.game_id, row.mode)!
  return {
    gameId: row.game_id,
    gameNumber: gameNumber(timestamp),
    mode: row.mode,
    wordLength: answer.key.length,
    maxAttempts: MAX_ATTEMPTS[row.mode],
    guesses: row.guesses,
    results: row.guesses.map((guess) => grade(guess, answer.key)),
    status: row.status,
    ...(row.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
}
