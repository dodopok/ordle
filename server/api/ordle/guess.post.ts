import { answerFor, gameId, grade, normalize, MAX_ATTEMPTS, WORD_LENGTH } from '../../utils/ordle'
import { isValidGuess } from '../../utils/dictionary'
import { COOKIE_NAME, cookieOptions, seal, unseal, type Session } from '../../utils/session'
import { rateLimit } from '../../utils/ratelimit'

export default defineEventHandler(async (event) => {
  rateLimit(event)

  const now = Date.now()
  const id = gameId(now)
  const body = await readBody<{ guess?: string }>(event)
  const key = normalize(body?.guess ?? '')

  if (key.length !== WORD_LENGTH || !/^[A-Z]{5}$/.test(key))
    throw createError({ statusCode: 400, statusMessage: 'invalid_length' })

  // palavra desconhecida não consome tentativa
  if (!isValidGuess(key)) throw createError({ statusCode: 422, statusMessage: 'unknown_word' })

  const prev = unseal(getCookie(event, COOKIE_NAME))
  const s: Session = prev?.id === id ? prev : { id, guesses: [], status: 'playing' }

  if (s.status !== 'playing' || s.guesses.length >= MAX_ATTEMPTS)
    throw createError({ statusCode: 409, statusMessage: 'game_over' })

  const answer = answerFor(now)
  s.guesses.push(key)
  if (key === answer.key) s.status = 'won'
  else if (s.guesses.length >= MAX_ATTEMPTS) s.status = 'lost'

  setCookie(event, COOKIE_NAME, seal(s), cookieOptions())

  return {
    result: grade(key, answer.key),
    status: s.status,
    attemptsLeft: MAX_ATTEMPTS - s.guesses.length,
    ...(s.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
})
