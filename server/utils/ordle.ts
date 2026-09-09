import { WORDS, type Entry } from './words'
import { WORDS_HARD } from './words-hard'

export type Mark = 'correct' | 'present' | 'absent'

/**
 * Dois jogos por dia, não um jogo com um ajuste. Cada modo tem lista, ordem,
 * cookie e estatística próprios — o difícil não é o normal com menos ajuda.
 */
export type Mode = 'normal' | 'hard'
export const isMode = (v: unknown): v is Mode => v === 'normal' || v === 'hard'

/**
 * 7 no difícil, contra 6 no normal: uma tentativa a mais para compensar as
 * palavras maiores, sem fazer o tabuleiro mudar de altura conforme o dia
 * (o que aconteceria se as tentativas acompanhassem o comprimento).
 */
export const MAX_ATTEMPTS: Record<Mode, number> = { normal: 6, hard: 7 }

/**
 * Dia 1 do jogo — a data de lançamento, não um marco arbitrário.
 *
 * ⚠️  NÃO MEXA NISTO COM O JOGO NO AR. Esta constante faz duas coisas ao mesmo
 *     tempo: numera os dias e indexa a palavra do dia. Mudá-la depois do
 *     lançamento renumera todo mundo (o "#142" que as pessoas compartilharam
 *     passa a apontar para outro dia) e ainda troca a resposta no meio do dia,
 *     invalidando as partidas em andamento — os palpites já dados foram
 *     coloridos contra a palavra antiga.
 */
const LAUNCH = Date.UTC(2026, 7, 17)
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000 // America/Sao_Paulo
const DAY_MS = 86_400_000

/**
 * Contagem 1-based: o dia do lançamento é o #1, não o #0. É número que aparece
 * no header e no texto de compartilhamento, então começa onde uma pessoa
 * espera que comece.
 *
 * Se o horário de verão voltar, troque o offset fixo por
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` formatando
 * a data direto. Para agora, offset fixo é suficiente e mais barato.
 */
export function gameNumber(now: number = Date.now()): number {
  const local = now + TZ_OFFSET_MS
  return Math.floor((local - LAUNCH) / DAY_MS) + 1
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

// embaralha com seed fixa, pra ordem não ser a do array
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Lotes das listas de respostas — a ordem é **estável por prefixo**.
 *
 * ⚠️  NÃO REEMBARALHE UMA LISTA INTEIRA COM O JOGO NO AR. Embaralhar tudo de
 *     novo (que é o que acontece se você só acrescentar palavras a uma
 *     permutação única) troca a resposta de dias já jogados — o "#7" que
 *     alguém compartilhou passa a apontar para outra palavra — e, se pegar o
 *     dia corrente, invalida as partidas em andamento.
 *
 * Por isso o embaralhamento é feito em lotes: cada lote é embaralhado só entre
 * si e concatenado no fim, então acrescentar palavras nunca mexe no que já foi
 * sorteado. Como `answerFor` indexa por `n % ORDER.length`, o ciclo apenas
 * fica mais longo: os dias de hoje até o fim do lote atual continuam iguais.
 *
 * Para acrescentar palavras: escreva as entradas novas **no fim** da lista do
 * modo e abra um lote novo aqui, com a quantidade e uma seed própria. Nunca
 * mexa num lote fechado nem intercale palavra no meio da lista.
 */
const BATCHES: Record<Mode, { size: number; seed: number }[]> = {
  normal: [
    { size: 69, seed: 20260817 }, // lançamento
    { size: 45, seed: 20260908 }, // segunda leva
    { size: 40, seed: 20260909 }, // terceira leva
  ],
  hard: [
    { size: 69, seed: 20260910 }, // estreia do modo difícil
  ],
}

const LISTS: Record<Mode, Entry[]> = { normal: WORDS, hard: WORDS_HARD }

const order = (mode: Mode) => {
  const total = BATCHES[mode].reduce((n, b) => n + b.size, 0)
  if (total !== LISTS[mode].length) {
    // fail-closed: sobrando, a palavra nova nunca sairia; faltando, o índice
    // estoura e `answerFor` devolve undefined no meio da madrugada
    throw new Error(
      `ordle: BATCHES.${mode} soma ${total} mas a lista tem ${LISTS[mode].length} — abra um lote novo em vez de esticar um fechado`,
    )
  }

  const out: number[] = []
  for (const { size, seed } of BATCHES[mode]) {
    const rand = mulberry32(seed)
    const idx = Array.from({ length: size }, (_, i) => out.length + i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    out.push(...idx)
  }
  return out
}

const ORDERS: Record<Mode, number[]> = { normal: order('normal'), hard: order('hard') }

export function answerFor(now: number = Date.now(), mode: Mode = 'normal'): Entry {
  const n = gameNumber(now)
  const ord = ORDERS[mode]
  return LISTS[mode][ord[((n % ord.length) + ord.length) % ord.length]]
}

/**
 * Coloração em dois passes. O ingênuo (um passe) erra com letra repetida:
 * resposta SALMO, palpite SALSA → o segundo S tem que sair cinza, não amarelo.
 */
export function grade(guessKey: string, answerKey: string): Mark[] {
  // o comprimento sai da resposta do dia: no modo difícil ele varia de 6 a 8
  const len = answerKey.length
  const out: Mark[] = Array(len).fill('absent')
  const pool: Record<string, number> = {}

  // passe 1: acertos exatos
  for (let i = 0; i < len; i++) {
    if (guessKey[i] === answerKey[i]) out[i] = 'correct'
    else pool[answerKey[i]] = (pool[answerKey[i]] ?? 0) + 1
  }

  // passe 2: presentes, consumindo o que sobrou
  for (let i = 0; i < len; i++) {
    if (out[i] === 'correct') continue
    const c = guessKey[i]
    if (pool[c] > 0) {
      out[i] = 'present'
      pool[c]--
    }
  }

  return out
}
