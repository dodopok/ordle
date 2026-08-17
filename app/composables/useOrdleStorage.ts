import type { GameStatus, Mark } from '../utils/ordle-shared'

const GAME = 'ordle:game:v1'
const STATS = 'ordle:stats:v1'
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

export type Prefs = { v: 1; theme: 'light' | 'dark' | 'system'; highContrast: boolean; sound: boolean }

const emptyStats = (): Stats => ({
  v: 1,
  played: 0,
  wins: 0,
  streak: 0,
  maxStreak: 0,
  distribution: [0, 0, 0, 0, 0, 0],
  lastGameId: null,
  lastResult: null,
})

const defaultPrefs = (): Prefs => ({ v: 1, theme: 'system', highContrast: false, sound: true })

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

  function loadGame(): StoredGame | null {
    const g = read<StoredGame>(GAME)
    return g?.v === 1 ? g : null
  }

  function saveGame(s: {
    gameId: string
    gameNumber: number
    guesses: string[]
    results: Mark[][]
    status: GameStatus
    answer: string | null
    definition: string | null
  }) {
    write(GAME, {
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

  const clearGame = () => {
    if (import.meta.client) localStorage.removeItem(GAME)
  }

  const loadStats = (): Stats => read<Stats>(STATS) ?? emptyStats()

  function recordResult(s: { gameId: string; status: GameStatus; guesses: string[] }): Stats {
    const st = loadStats()
    if (st.lastGameId === s.gameId) return st // idempotente: não conta duas vezes
    if (s.status === 'playing') return st

    st.played++
    if (s.status === 'won') {
      st.wins++
      st.distribution[s.guesses.length - 1]++
      st.streak = st.lastGameId === null || isYesterday(st.lastGameId, s.gameId) ? st.streak + 1 : 1
      st.maxStreak = Math.max(st.maxStreak, st.streak)
    } else {
      st.streak = 0
    }
    st.lastGameId = s.gameId
    st.lastResult = s.status
    write(STATS, st)
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
