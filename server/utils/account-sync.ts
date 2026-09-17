import { canonicalGame, type CanonicalImportedGame } from './account'
import type { Mode } from './ordle'

const MODES: Mode[] = ['normal', 'hard']

type SnapshotLike = {
  history?: Partial<Record<Mode, unknown[]>>
  games?: Partial<Record<Mode, unknown | null>>
}

export function isTerminalGame(status: CanonicalImportedGame['status']): boolean {
  return status === 'won' || status === 'lost'
}

/**
 * Escolhe uma única versão de uma partida encontrada em dois dispositivos.
 * Uma partida encerrada vence um progresso parcial; entre encerradas, vitória
 * vence derrota; entre resultados iguais, a melhor pontuação e o snapshot mais
 * recente vencem. O banco tem uma chave única por usuário/dia/modo, então essa
 * escolha é o que impede a segunda partida no mesmo dia.
 */
export function betterImportedGame(
  a: CanonicalImportedGame,
  b: CanonicalImportedGame,
): CanonicalImportedGame {
  if (isTerminalGame(a.status) !== isTerminalGame(b.status)) return isTerminalGame(a.status) ? a : b
  if (a.status !== b.status) return a.status === 'won' ? a : b
  if (a.status !== 'playing' && a.attempts !== b.attempts)
    return a.attempts < b.attempts ? a : b
  return Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b
}

/**
 * Converte o histórico e o jogo corrente do browser para partidas canônicas,
 * removendo duplicatas por modo + dia antes de falar com o Supabase.
 */
export function importedGames(snapshot: SnapshotLike): CanonicalImportedGame[] {
  const byKey = new Map<string, CanonicalImportedGame>()
  for (const mode of MODES) {
    const values = [
      ...(Array.isArray(snapshot.history?.[mode]) ? snapshot.history[mode]! : []),
      snapshot.games?.[mode],
    ]
    for (const value of values) {
      const game = canonicalGame(value, mode)
      if (!game) continue
      const key = `${game.mode}:${game.gameId}`
      const previous = byKey.get(key)
      byKey.set(key, previous ? betterImportedGame(previous, game) : game)
    }
  }
  return [...byKey.values()]
}
