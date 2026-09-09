import { answerFor, gameId, gameNumber, grade, isMode, nextRolloverAt, MAX_ATTEMPTS } from '../../utils/ordle'
import { cookieName, cookieOptions, seal, unseal, type Session } from '../../utils/session'
import { liturgicalDay } from '../../utils/liturgy'

export default defineEventHandler(async (event) => {
  const now = Date.now()
  const id = gameId(now)
  const raw = getQuery(event).mode
  const mode = isMode(raw) ? raw : 'normal'

  const cookie = cookieName(mode)
  const prev = unseal(getCookie(event, cookie))
  // dia diferente ou cookie do outro modo: partida nova
  const fresh = prev?.id !== id || prev.mode !== mode
  const s: Session = fresh ? { id, guesses: [], status: 'playing', mode } : prev

  // vira o dia com a aba aberta / cookie de ontem: começa partida nova
  if (fresh) setCookie(event, cookie, seal(s), cookieOptions())

  const answer = answerFor(now, mode)
  const day = await liturgicalDay(id)

  return {
    gameId: id,
    gameNumber: gameNumber(now),
    mode,
    // no difícil o comprimento é o da palavra do dia, de 6 a 8
    wordLength: answer.key.length,
    maxAttempts: MAX_ATTEMPTS[mode],
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
