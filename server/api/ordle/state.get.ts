import { answerFor, gameId, gameNumber, grade, nextRolloverAt, MAX_ATTEMPTS, WORD_LENGTH } from '../../utils/ordle'
import { COOKIE_NAME, cookieOptions, seal, unseal, type Session } from '../../utils/session'
import { liturgicalDay } from '../../utils/liturgy'

export default defineEventHandler(async (event) => {
  const now = Date.now()
  const id = gameId(now)
  const prev = unseal(getCookie(event, COOKIE_NAME))
  const s: Session = prev?.id === id ? prev : { id, guesses: [], status: 'playing' }

  // vira o dia com a aba aberta / cookie de ontem: começa partida nova
  if (prev?.id !== id) setCookie(event, COOKIE_NAME, seal(s), cookieOptions())

  const answer = answerFor(now)
  const day = await liturgicalDay(id)

  return {
    gameId: id,
    gameNumber: gameNumber(now),
    wordLength: WORD_LENGTH,
    maxAttempts: MAX_ATTEMPTS,
    guesses: s.guesses,
    results: s.guesses.map((g) => grade(g, answer.key)),
    status: s.status,
    nextRolloverAt: nextRolloverAt(now),
    liturgicalColor: day.color,
    liturgicalSeason: day.season,
    liturgicalCelebration: day.celebration,
    liturgicalPsalm: day.psalm ?? null,
    // a resposta só sai do servidor com a partida encerrada
    ...(s.status !== 'playing' && { answer: answer.word, definition: answer.definition }),
  }
})
