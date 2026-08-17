export type LiturgicalColor = 'green' | 'purple' | 'red' | 'white' | 'rose'

export type LiturgicalDay = {
  color: LiturgicalColor
  season: string
  /** Rótulo curto do dia, usado no gancho da tela de resultado. */
  celebration: string
}

/**
 * Cor litúrgica do dia.
 *
 * Preferimos a Estêvão API (a mesma que alimenta o Ordo). Ela é opcional: se
 * `ORDLE_LITURGY_API` não estiver setada, ou a chamada falhar/estourar o
 * timeout, caímos no cálculo local. O jogo nunca deve quebrar por causa de um
 * filete colorido no header.
 *
 * A API precisa responder JSON com, no mínimo, `color` (em pt-BR ou en) e
 * opcionalmente `season` e `description`/`celebration`.
 * Ex.: ORDLE_LITURGY_API="https://exemplo.app/api/liturgical-day?date="
 */
const API_TIMEOUT_MS = 1500
const CACHE_TTL_MS = 60 * 60 * 1000

const cache = new Map<string, { at: number; day: LiturgicalDay }>()

const COLOR_ALIASES: Record<string, LiturgicalColor> = {
  verde: 'green',
  green: 'green',
  roxo: 'purple',
  violeta: 'purple',
  purple: 'purple',
  violet: 'purple',
  vermelho: 'red',
  red: 'red',
  branco: 'white',
  white: 'white',
  dourado: 'white',
  gold: 'white',
  rosa: 'rose',
  rose: 'rose',
  pink: 'rose',
}

export function parseColor(raw: unknown): LiturgicalColor | null {
  if (typeof raw !== 'string') return null
  return COLOR_ALIASES[raw.trim().toLowerCase()] ?? null
}

export async function liturgicalDay(gameId: string): Promise<LiturgicalDay> {
  const hit = cache.get(gameId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.day

  const day = (await fromApi(gameId)) ?? computeLiturgicalDay(gameId)
  cache.set(gameId, { at: Date.now(), day })
  return day
}

async function fromApi(gameId: string): Promise<LiturgicalDay | null> {
  const base = process.env.ORDLE_LITURGY_API
  if (!base) return null
  try {
    const res = await $fetch<Record<string, unknown>>(`${base}${gameId}`, {
      timeout: API_TIMEOUT_MS,
      retry: 0,
    })
    const color = parseColor(res?.color)
    if (!color) return null
    const description = Array.isArray(res?.description) ? res.description[0] : res?.description
    const fallback = computeLiturgicalDay(gameId)
    return {
      color,
      season: typeof res?.season === 'string' ? res.season : fallback.season,
      celebration:
        typeof res?.celebration === 'string'
          ? res.celebration
          : typeof description === 'string'
            ? description
            : fallback.celebration,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cálculo local (fallback)
// ---------------------------------------------------------------------------

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const DAY = 86_400_000

/** Páscoa gregoriana (algoritmo anônimo / Meeus). */
export function easter(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(year, month - 1, day)
}

/** Primeiro domingo do Advento: 4º domingo antes do Natal. */
function adventStart(year: number): number {
  const christmas = Date.UTC(year, 11, 25)
  const dow = new Date(christmas).getUTCDay() // 0 = domingo
  const fourthSundayBefore = christmas - (dow === 0 ? 28 : 21 + dow) * DAY
  return fourthSundayBefore
}

/**
 * Aproximação do calendário do Ordo suficiente para pintar um filete de 3px.
 * Cobre estações, Gaudete/Laetare, Semana Santa, Pentecostes e algumas festas
 * de data fixa. Quando a Estêvão API estiver configurada, ela manda.
 */
export function computeLiturgicalDay(gameId: string): LiturgicalDay {
  const t = dayOf(gameId)
  if (Number.isNaN(t)) return { color: 'green', season: 'Tempo Comum', celebration: 'Féria' }

  const d = new Date(t)
  const year = d.getUTCFullYear()
  const md = gameId.slice(5) // MM-DD
  const isSunday = d.getUTCDay() === 0

  const pascha = easter(year)
  const ashWednesday = pascha - 46 * DAY
  const palmSunday = pascha - 7 * DAY
  const goodFriday = pascha - 2 * DAY
  const pentecost = pascha + 49 * DAY
  const trinity = pascha + 56 * DAY
  const advent = adventStart(year)

  const day = (label: string, color: LiturgicalColor, season: string) => ({
    color,
    season,
    celebration: label,
  })

  // festas fixas que valem o desvio de cor
  const fixed: Record<string, LiturgicalDay> = {
    '01-01': day('Santa Maria, Mãe de Deus', 'white', 'Natal'),
    '01-06': day('Epifania do Senhor', 'white', 'Epifania'),
    '06-29': day('São Pedro e São Paulo', 'red', 'Tempo Comum'),
    '07-25': day('São Tiago, Apóstolo', 'red', 'Tempo Comum'),
    '10-18': day('São Lucas, Evangelista', 'red', 'Tempo Comum'),
    '10-28': day('São Simão e São Judas', 'red', 'Tempo Comum'),
    '11-01': day('Todos os Santos', 'white', 'Tempo Comum'),
    '11-30': day('Santo André, Apóstolo', 'red', 'Advento'),
    '12-25': day('Natal do Senhor', 'white', 'Natal'),
    '12-26': day('Santo Estêvão, Protomártir', 'red', 'Natal'),
  }
  if (fixed[md]) return fixed[md]

  // Tríduo e Semana Santa
  if (t === palmSunday) return day('Domingo de Ramos', 'red', 'Quaresma')
  if (t === goodFriday) return day('Sexta-feira Santa', 'red', 'Semana Santa')
  if (t > palmSunday && t < pascha) return day('Semana Santa', 'purple', 'Semana Santa')

  // Páscoa
  if (t === pascha) return day('Domingo da Ressurreição', 'white', 'Páscoa')
  if (t === pentecost) return day('Pentecostes', 'red', 'Pentecostes')
  if (t === trinity) return day('Santíssima Trindade', 'white', 'Tempo Comum')
  if (t > pascha && t < pentecost)
    return day(isSunday ? 'Domingo da Páscoa' : 'Féria', 'white', 'Páscoa')

  // Quaresma
  if (t >= ashWednesday && t < palmSunday) {
    if (t === ashWednesday) return day('Quarta-feira de Cinzas', 'purple', 'Quaresma')
    const laetare = pascha - 21 * DAY // 4º domingo da Quaresma
    if (t === laetare) return day('Domingo Laetare', 'rose', 'Quaresma')
    return day(isSunday ? 'Domingo da Quaresma' : 'Féria', 'purple', 'Quaresma')
  }

  // Advento e Natal
  if (t >= advent && t <= Date.UTC(year, 11, 24)) {
    const gaudete = advent + 14 * DAY // 3º domingo do Advento
    if (t === gaudete) return day('Domingo Gaudete', 'rose', 'Advento')
    return day(isSunday ? 'Domingo do Advento' : 'Féria', 'purple', 'Advento')
  }
  if (t > Date.UTC(year, 11, 25) || t < Date.UTC(year, 0, 6))
    return day(isSunday ? 'Domingo do Natal' : 'Féria', 'white', 'Natal')

  return day(isSunday ? 'Domingo do Tempo Comum' : 'Féria', 'green', 'Tempo Comum')
}
