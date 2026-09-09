import { MAX_ATTEMPTS, type GameStatus, type Mark, type Mode } from '../utils/ordle-shared'

/**
 * Uma gaveta por modo. O modo normal fica nas chaves originais, sem sufixo:
 * quem tem partida de hoje ou uma sequência de 30 dias no `localStorage` não
 * pode perder nada quando o modo difícil entrar no ar.
 */
const GAME = (mode: Mode) => (mode === 'hard' ? 'ordle:game:hard:v1' : 'ordle:game:v1')
const STATS = (mode: Mode) => (mode === 'hard' ? 'ordle:stats:hard:v1' : 'ordle:stats:v1')
const PREFS = 'ordle:prefs:v1'

export type StoredGame = {
  v: 1
  gameId: string
  gameNumber: number
  guesses: string[]
  results: Mark[][]
  status: GameStatus
  answer: string | null
  definition: string | null
}

export type Stats = {
  v: 1
  played: number
  wins: number
  streak: number
  maxStreak: number
  distribution: number[]
  lastGameId: string | null
  lastResult: GameStatus | null
}

export type Prefs = {
  v: 1
  theme: 'light' | 'dark' | 'system'
  highContrast: boolean
  sound: boolean
  /** o modo em que a pessoa estava, para reabrir a aba onde ela parou */
  mode: Mode
}

/**
 * A distribuição tem uma barra por tentativa, então o tamanho segue o modo:
 * 6 no normal, 7 no difícil. Fixar em 6 faria a vitória na 7ª incrementar uma
 * posição inexistente — `undefined + 1` é NaN, e o gráfico quebra calado.
 */
const emptyStats = (mode: Mode): Stats => ({
  v: 1,
  played: 0,
  wins: 0,
  streak: 0,
  maxStreak: 0,
  distribution: Array<number>(MAX_ATTEMPTS[mode]).fill(0),
  lastGameId: null,
  lastResult: null,
})

const defaultPrefs = (): Prefs => ({
  v: 1,
  theme: 'system',
  highContrast: false,
  sound: true,
  mode: 'normal',
})

export function useOrdleStorage() {
  const read = <T>(k: string): T | null => {
    if (!import.meta.client) return null
    try {
      return JSON.parse(localStorage.getItem(k) ?? 'null')
    } catch {
      return null
    }
  }
  const write = (k: string, v: unknown) => {
    if (!import.meta.client) return
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* Safari em navegação privada estoura QuotaExceededError — ignora */
    }
  }

  function loadGame(mode: Mode): StoredGame | null {
    const g = read<StoredGame>(GAME(mode))
    return g?.v === 1 ? g : null
  }

  function saveGame(mode: Mode, s: {
    gameId: string
    gameNumber: number
    guesses: string[]
    results: Mark[][]
    status: GameStatus
    answer: string | null
    definition: string | null
  }) {
    write(GAME(mode), {
      v: 1,
      gameId: s.gameId,
      gameNumber: s.gameNumber,
      guesses: s.guesses,
      results: s.results,
      status: s.status,
      answer: s.answer,
      definition: s.definition,
    })
  }

  const clearGame = (mode: Mode) => {
    if (import.meta.client) localStorage.removeItem(GAME(mode))
  }

  function loadStats(mode: Mode): Stats {
    const st = read<Stats>(STATS(mode))
    if (!st) return emptyStats(mode)
    // estatística gravada antes de o modo existir pode ter a barra a menos
    const bars = MAX_ATTEMPTS[mode]
    const distribution = Array.from({ length: bars }, (_, i) => st.distribution?.[i] ?? 0)
    return { ...st, distribution }
  }

  function recordResult(
    mode: Mode,
    s: { gameId: string; status: GameStatus; guesses: string[] },
  ): Stats {
    const st = loadStats(mode)
    if (st.lastGameId === s.gameId) return st // idempotente: não conta duas vezes
    if (s.status === 'playing') return st

    st.played++
    if (s.status === 'won') {
      st.wins++
      st.distribution[s.guesses.length - 1] = (st.distribution[s.guesses.length - 1] ?? 0) + 1
      st.streak = st.lastGameId === null || isYesterday(st.lastGameId, s.gameId) ? st.streak + 1 : 1
      st.maxStreak = Math.max(st.maxStreak, st.streak)
    } else {
      st.streak = 0
    }
    st.lastGameId = s.gameId
    st.lastResult = s.status
    write(STATS(mode), st)
    return st
  }

  const loadPrefs = (): Prefs => ({ ...defaultPrefs(), ...(read<Prefs>(PREFS) ?? {}), v: 1 })
  const savePrefs = (p: Prefs) => write(PREFS, p)

  return { loadGame, saveGame, clearGame, loadStats, recordResult, loadPrefs, savePrefs }
}

export function isYesterday(prev: string | null, current: string) {
  if (!prev) return false
  const d =
    (new Date(current + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime()) /
    86_400_000
  return d === 1
}
