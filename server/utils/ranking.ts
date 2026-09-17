import { MAX_ATTEMPTS, type Mode } from './ordle'

export type RankingStatsRow = {
  user_id: string
  mode: Mode
  played: number
  wins: number
  distribution: unknown
}

export type RankingAggregate = {
  points: number
  wins: number
  played: number
  attempts: number
}

function count(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

/** Converte estatística agregada, inclusive de importação legada, em ranking. */
export function aggregateRankingStats(rows: RankingStatsRow[]): RankingAggregate {
  return rows.reduce<RankingAggregate>(
    (total, row) => {
      const maxAttempts = MAX_ATTEMPTS[row.mode]
      const distribution = Array.isArray(row.distribution) ? row.distribution : []
      for (let index = 0; index < maxAttempts; index++) {
        const wins = count(distribution[index])
        total.points += wins * (maxAttempts - index)
        total.attempts += wins * (index + 1)
      }
      total.wins += count(row.wins)
      total.played += count(row.played)
      return total
    },
    { points: 0, wins: 0, played: 0, attempts: 0 },
  )
}
