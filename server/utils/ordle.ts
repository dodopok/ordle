import { WORDS, type Entry } from './words'

export type Mark = 'correct' | 'present' | 'absent'

export const WORD_LENGTH = 5
export const MAX_ATTEMPTS = 6

const EPOCH = Date.UTC(2026, 0, 1) // dia 0 do jogo
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000 // America/Sao_Paulo
const DAY_MS = 86_400_000

/**
 * Se o horário de verão voltar, troque o offset fixo por
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` formatando
 * a data direto. Para agora, offset fixo é suficiente e mais barato.
 */
export function gameNumber(now: number = Date.now()): number {
  const local = now + TZ_OFFSET_MS
  return Math.floor((local - EPOCH) / DAY_MS)
}

export function gameId(now: number = Date.now()): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** Instante (epoch ms, UTC) da próxima virada de dia em America/Sao_Paulo. */
export function nextRolloverAt(now: number = Date.now()): number {
  const local = now + TZ_OFFSET_MS
  const nextLocalMidnight = Math.floor(local / DAY_MS) * DAY_MS + DAY_MS
  return nextLocalMidnight - TZ_OFFSET_MS
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()

// embaralha uma vez, com seed fixa, pra ordem não ser a do array
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ORDER = (() => {
  const rand = mulberry32(20260817)
  const idx = WORDS.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
})()

export function answerFor(now: number = Date.now()): Entry {
  const n = gameNumber(now)
  return WORDS[ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length]]
}

/**
 * Coloração em dois passes. O ingênuo (um passe) erra com letra repetida:
 * resposta SALMO, palpite SALSA → o segundo S tem que sair cinza, não amarelo.
 */
export function grade(guessKey: string, answerKey: string): Mark[] {
  const out: Mark[] = Array(WORD_LENGTH).fill('absent')
  const pool: Record<string, number> = {}

  // passe 1: acertos exatos
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guessKey[i] === answerKey[i]) out[i] = 'correct'
    else pool[answerKey[i]] = (pool[answerKey[i]] ?? 0) + 1
  }

  // passe 2: presentes, consumindo o que sobrou
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (out[i] === 'correct') continue
    const c = guessKey[i]
    if (pool[c] > 0) {
      out[i] = 'present'
      pool[c]--
    }
  }

  return out
}
