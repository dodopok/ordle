/**
 * Helpers puros compartilhados com o client.
 *
 * Não importa nada de `server/` — em especial nada que leve a `words.ts`.
 */
export type Mark = 'correct' | 'present' | 'absent'
export type GameStatus = 'playing' | 'won' | 'lost'

export const WORD_LENGTH = 5
export const MAX_ATTEMPTS = 6

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()

/** Prioridade das teclas: uma tecla nunca "piora" ao longo da partida. */
const RANK: Record<Mark, number> = { absent: 1, present: 2, correct: 3 }

export function keyboardState(guesses: string[], results: Mark[][]): Record<string, Mark> {
  const out: Record<string, Mark> = {}
  guesses.forEach((guess, row) => {
    const marks = results[row]
    if (!marks) return
    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i]
      const mark = marks[i]
      if (!mark) continue
      if (!out[letter] || RANK[mark] > RANK[out[letter]]) out[letter] = mark
    }
  })
  return out
}

const EMOJI: Record<Mark, string> = { correct: '🟩', present: '🟨', absent: '⬜' }
const EMOJI_DARK: Record<Mark, string> = { correct: '🟩', present: '🟨', absent: '⬛' }

export function shareText(opts: {
  gameNumber: number
  results: Mark[][]
  status: GameStatus
  dark?: boolean
  url?: string
}) {
  const palette = opts.dark ? EMOJI_DARK : EMOJI
  const score = opts.status === 'won' ? `${opts.results.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`
  const grid = opts.results.map((row) => row.map((m) => palette[m]).join('')).join('\n')
  return `Ordle #${opts.gameNumber} · ${score}\n\n${grid}\n\n${opts.url ?? 'ofício.app/ordle'}`
}
