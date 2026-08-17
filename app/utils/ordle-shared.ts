/**
 * Helpers puros compartilhados com o client.
 *
 * Não importa nada de `server/` — em especial nada que leve a `words.ts`.
 */
export type Mark = 'correct' | 'present' | 'absent'
export type GameStatus = 'playing' | 'won' | 'lost'
export type Platform = 'ios' | 'android' | 'desktop'

/**
 * Para onde mandar quem clica no gancho do Ordo: loja da plataforma no
 * celular, site no desktop.
 *
 * A ordem importa. O iPad a partir do iPadOS 13 se apresenta como Macintosh,
 * então só o user agent não distingue — o que o denuncia é ter touch. A
 * heurística de touch fica restrita ao UA de Mac de propósito: notebook
 * Windows com tela sensível ao toque não pode virar "celular".
 */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios'
  return 'desktop'
}

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

/**
 * A primeira linha do texto compartilhado.
 *
 * "2/6" é convenção de quem já joga; num grupo de WhatsApp onde a maioria
 * nunca viu o jogo, uma frase diz a mesma coisa e ainda explica o que é. O
 * número continua ali — dá para comparar com o do vizinho do mesmo jeito.
 */
export function shareHeadline(gameNumber: number, attempts: number, status: GameStatus) {
  const jogo = `o Ordle #${gameNumber}`
  if (status !== 'won') return `Não acertei ${jogo} hoje.`
  if (attempts === 1) return `Acertei ${jogo} de primeira!`
  return `Acertei ${jogo} em ${attempts} tentativas.`
}

export function shareText(opts: {
  gameNumber: number
  results: Mark[][]
  status: GameStatus
  dark?: boolean
  url?: string
}) {
  const palette = opts.dark ? EMOJI_DARK : EMOJI
  const headline = shareHeadline(opts.gameNumber, opts.results.length, opts.status)
  const grid = opts.results.map((row) => row.map((m) => palette[m]).join('')).join('\n')
  return `${headline}\n\n${grid}\n\n${opts.url ?? 'ofício.app'}`
}
