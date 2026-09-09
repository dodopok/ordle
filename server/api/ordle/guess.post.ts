import { answerFor, gameId, grade, isMode, normalize, MAX_ATTEMPTS } from '../../utils/ordle'
import { isValidGuess } from '../../utils/dictionary'
import { cookieName, cookieOptions, seal, unseal, type Session } from '../../utils/session'
import { rateLimit } from '../../utils/ratelimit'

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
  const s: Session =
    prev?.id === id && prev.mode === mode ? prev : { id, guesses: [], status: 'playing', mode }

  const max = MAX_ATTEMPTS[mode]
  if (s.status !== 'playing' || s.guesses.length >= max)
    throw createError({ statusCode: 409, statusMessage: 'game_over' })

  s.guesses.push(key)
  if (key === answer.key) s.status = 'won'
  else if (s.guesses.length >= max) s.status = 'lost'

  setCookie(event, cookie, seal(s), cookieOptions())

  return {
    result: grade(key, answer.key),
    status: s.status,
    attemptsLeft: max - s.guesses.length,
    ...(s.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
})
