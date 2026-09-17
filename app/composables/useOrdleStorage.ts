import { MAX_ATTEMPTS, type GameStatus, type Mark, type Mode } from '../utils/ordle-shared'

/**
 * Uma gaveta por modo. O modo normal fica nas chaves originais, sem sufixo:
 * quem tem partida de hoje ou uma sequência de 30 dias no `localStorage` não
 * pode perder nada quando o modo difícil entrar no ar.
 */
const GAME = (mode: Mode) => (mode === 'hard' ? 'ordle:game:hard:v1' : 'ordle:game:v1')
const STATS = (mode: Mode) => (mode === 'hard' ? 'ordle:stats:hard:v1' : 'ordle:stats:v1')
const HISTORY = (mode: Mode) => (mode === 'hard' ? 'ordle:history:hard:v1' : 'ordle:history:v1')
const PREFS = 'ordle:prefs:v1'
const DEVICE = 'ordle:device:v1'
const SYNC = 'ordle:sync:v1'

export type StoredGame = {
  v: 1
  gameId: string
  gameNumber: number
  /** guardado para o difícil poder pintar o tabuleiro antes da rede responder */
  wordLength?: number
  guesses: string[]
  results: Mark[][]
  status: GameStatus
  answer: string | null
  definition: string | null
  /** usado para resolver progresso simultâneo em dois dispositivos */
  updatedAt?: string
}

/**
 * Registro por dia. As estatísticas agregadas antigas continuam existindo para
 * não quebrar usuários atuais, mas os dados novos passam a ter uma chave
 * natural (dia + modo), que permite sincronizar sem contar duas vezes.
 */
export type GameHistoryEntry = {
  v: 1
  gameId: string
  gameNumber: number
  wordLength: number
  guesses: string[]
  status: Exclude<GameStatus, 'playing'>
  completedAt: string
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

export type SyncSnapshot = {
  v: 1
  migrationId: string
  deviceId: string
  stats: Record<Mode, Stats>
  games: Record<Mode, StoredGame | null>
  history: Record<Mode, GameHistoryEntry[]>
  prefs: Prefs
}

type SyncState = {
  v: 1
  users: Record<string, { migrationId: string; completedAt: string }>
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
    wordLength: number
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
      wordLength: s.wordLength,
      guesses: s.guesses,
      results: s.results,
      status: s.status,
      answer: s.answer,
      definition: s.definition,
      updatedAt: new Date().toISOString(),
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

  function loadHistory(mode: Mode): GameHistoryEntry[] {
    const history = read<GameHistoryEntry[]>(HISTORY(mode))
    if (!Array.isArray(history)) return []
    return history.filter(
      (entry) =>
        entry?.v === 1 &&
        typeof entry.gameId === 'string' &&
        typeof entry.gameNumber === 'number' &&
        typeof entry.wordLength === 'number' &&
        Array.isArray(entry.guesses) &&
        (entry.status === 'won' || entry.status === 'lost'),
    )
  }

  function recordHistory(
    mode: Mode,
    entry: Omit<GameHistoryEntry, 'v'>,
  ): GameHistoryEntry[] {
    const history = loadHistory(mode).filter((old) => old.gameId !== entry.gameId)
    history.push({ v: 1, ...entry })
    history.sort((a, b) => a.gameId.localeCompare(b.gameId))
    // O ciclo atual de respostas é pequeno, mas o limite impede que uma
    // instalação antiga ou adulterada transforme o payload de sync em uma
    // coleção sem limite.
    const kept = history.slice(-400)
    write(HISTORY(mode), kept)
    return kept
  }

  function recordResult(
    mode: Mode,
    s: {
      gameId: string
      gameNumber?: number
      wordLength?: number
      status: GameStatus
      guesses: string[]
    },
  ): Stats {
    const st = loadStats(mode)
    if (s.status === 'playing') return st
    if (st.lastGameId === s.gameId || loadHistory(mode).some((g) => g.gameId === s.gameId)) return st

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
    recordHistory(mode, {
      gameId: s.gameId,
      gameNumber: s.gameNumber ?? 0,
      wordLength: s.wordLength ?? s.guesses[0]?.length ?? 0,
      guesses: [...s.guesses],
      status: s.status,
      completedAt: new Date().toISOString(),
    })
    return st
  }

  const loadPrefs = (): Prefs => ({ ...defaultPrefs(), ...(read<Prefs>(PREFS) ?? {}), v: 1 })
  const savePrefs = (p: Prefs) => write(PREFS, p)

  const saveStats = (mode: Mode, stats: Stats) => write(STATS(mode), { ...stats, v: 1 })

  function loadDeviceId(): string {
    const current = read<string>(DEVICE)
    if (current) return current
    const id =
      import.meta.client && typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
    write(DEVICE, id)
    return id
  }

  function loadSyncState(): SyncState {
    const current = read<SyncState>(SYNC)
    return current?.v === 1 && current.users ? current : { v: 1, users: {} }
  }

  function migrationIdFor(userId: string): string {
    const sync = loadSyncState()
    const current = sync.users[userId]
    if (current?.migrationId) return current.migrationId
    const id =
      import.meta.client && typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `migration-${Date.now()}-${Math.random().toString(36).slice(2)}`
    sync.users[userId] = { migrationId: id, completedAt: '' }
    write(SYNC, sync)
    return id
  }

  function markMigrationComplete(userId: string, migrationId: string) {
    const sync = loadSyncState()
    sync.users[userId] = { migrationId, completedAt: new Date().toISOString() }
    write(SYNC, sync)
  }

  function exportSnapshot(userId: string): SyncSnapshot {
    return {
      v: 1,
      migrationId: migrationIdFor(userId),
      deviceId: loadDeviceId(),
      stats: { normal: loadStats('normal'), hard: loadStats('hard') },
      games: { normal: loadGame('normal'), hard: loadGame('hard') },
      history: { normal: loadHistory('normal'), hard: loadHistory('hard') },
      prefs: loadPrefs(),
    }
  }

  return {
    loadGame,
    saveGame,
    clearGame,
    loadStats,
    saveStats,
    loadHistory,
    recordHistory,
    recordResult,
    loadPrefs,
    savePrefs,
    exportSnapshot,
    markMigrationComplete,
  }
}

export function isYesterday(prev: string | null, current: string) {
  if (!prev) return false
  const d =
    (new Date(current + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime()) /
    86_400_000
  return d === 1
}
