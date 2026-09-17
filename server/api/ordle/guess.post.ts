import { answerFor, gameId, grade, isMode, normalize, MAX_ATTEMPTS } from '../../utils/ordle'
import { isValidGuess } from '../../utils/dictionary'
import { cookieName, cookieOptions, seal, unseal, type Session } from '../../utils/session'
import { rateLimit } from '../../utils/ratelimit'
import { optionalUser, supabaseAdmin } from '../../utils/supabase'
import { readCloudGame, scoreFor } from '../../utils/account'

export default defineEventHandler(async (event) => {
  rateLimit(event)

  const now = Date.now()
  const id = gameId(now)
  const body = await readBody<{ guess?: string; mode?: string }>(event)
  const mode = isMode(body?.mode) ? body.mode : 'normal'
  const key = normalize(body?.guess ?? '')
  const answer = answerFor(now, mode)

  // o comprimento aceito é o da palavra do dia — no difícil ele varia
  if (key.length !== answer.key.length || !/^[A-Z]+$/.test(key))
    throw createError({ statusCode: 400, statusMessage: 'invalid_length' })

  // palavra desconhecida não consome tentativa
  if (!(await isValidGuess(key))) throw createError({ statusCode: 422, statusMessage: 'unknown_word' })

  const cookie = cookieName(mode)
  const prev = unseal(getCookie(event, cookie))
  const user = await optionalUser(event)
  const cloud = user ? await readCloudGame(event, user.id, id, mode) : null
  const s: Session = cloud
    ? { id, guesses: cloud.guesses, status: cloud.status, mode }
    : prev?.id === id && prev.mode === mode
      ? prev
      : { id, guesses: [], status: 'playing', mode }

  const max = MAX_ATTEMPTS[mode]
  if (s.status !== 'playing' || s.guesses.length >= max)
    throw createError({ statusCode: 409, statusMessage: 'game_over' })

  s.guesses.push(key)
  if (key === answer.key) s.status = 'won'
  else if (s.guesses.length >= max) s.status = 'lost'

  setCookie(event, cookie, seal(s), cookieOptions())

  let syncPending = false
  if (user) {
    try {
      const db = supabaseAdmin(event)
      const { error } = await db.rpc('ordle_record_server_game', {
        p_user_id: user.id,
        p_game_id: id,
        p_mode: mode,
        p_guesses: s.guesses,
        p_status: s.status,
        p_attempts: s.guesses.length,
        p_points: scoreFor(mode, s.status, s.guesses.length),
        p_completed_at: s.status === 'playing' ? null : new Date().toISOString(),
      })
      if (error) syncPending = true
    } catch {
      syncPending = true
    }
  }

  return {
    result: grade(key, answer.key),
    status: s.status,
    attemptsLeft: max - s.guesses.length,
    syncPending,
    ...(s.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
})
