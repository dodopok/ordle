export type LiturgicalColor = 'green' | 'purple' | 'red' | 'white' | 'rose'

export type LiturgicalDay = {
  color: LiturgicalColor
  season: string
  /** Rótulo curto do dia, usado no gancho da tela de resultado. */
  celebration: string
  /**
   * Referência do salmo do dia ("Salmo 130"), quando a API traz.
   * É o que dá concretude ao gancho do Ordo: dizer o que o Ofício traz hoje prova
   * que o app tem conteúdo, coisa que "baixe nosso aplicativo" não faz.
   */
  psalm?: string
}

/**
 * Cor litúrgica do dia, vinda da API do Caminho Anglicano — a mesma que
 * alimenta o Ordo.
 *
 *   GET https://api.caminhoanglicano.com.br/api/v1/calendar/:ano/:mes/:dia
 *
 * Dois requisitos da API, os dois retornando erro se faltarem:
 * - verificação de app: header `X-App-Internal-Id`, senão 401
 *   `APP_VERIFICATION_REQUIRED`. Valor em `ORDLE_LITURGY_KEY` — nunca
 *   hardcode a chave.
 * - `preferences[prayer_book_code]` na query, senão `PRAYER_BOOK_REQUIRED`.
 *
 * Tudo isso é opcional de propósito: sem chave, com erro, com 401 ou com
 * timeout, caímos no cálculo local. O jogo nunca deve quebrar — nem atrasar —
 * por causa de um filete colorido no header.
 */
const API_BASE = 'https://api.caminhoanglicano.com.br/api/v1/calendar'
const DEFAULT_HEADER = 'X-App-Internal-Id'
const DEFAULT_PRAYER_BOOK = 'loc_2015'
// medido: ~725ms na primeira chamada, 125-160ms quente, 30 KiB de payload
const API_TIMEOUT_MS = 2500
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

/**
 * Stale-while-revalidate: entrada fresca responde na hora; entrada vencida
 * responde na hora e revalida em segundo plano. Só a primeira chamada da
 * instância paga o round-trip até a API — e mesmo essa tem timeout curto.
 */
export async function liturgicalDay(gameId: string): Promise<LiturgicalDay> {
  const hit = cache.get(gameId)
  if (hit) {
    if (Date.now() - hit.at >= CACHE_TTL_MS) void refresh(gameId)
    return hit.day
  }
  return refresh(gameId)
}

async function refresh(gameId: string): Promise<LiturgicalDay> {
  const day = (await fromApi(gameId)) ?? computeLiturgicalDay(gameId)
  cache.set(gameId, { at: Date.now(), day })
  return day
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const trimmed = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

/**
 * Extrai o dia litúrgico do payload da API.
 *
 * Duas sutilezas do calendário, as duas verificadas contra respostas reais:
 *
 * 1. A cor do dia é `liturgical_color`, no topo — NUNCA `celebration.color`.
 *    Em 13/12/2026 a celebração é Luzia (`vermelho`), mas o dia é o Domingo
 *    Gaudete e sai `rosa`. Ler a cor da celebração pintaria o header errado.
 *
 * 2. A celebração nem sempre é o nome do dia. Só vale como rótulo quando a cor
 *    dela bate com a do dia, isto é, quando ela é que rege — festa que cede ao
 *    domingo vem com cor divergente. Em 18/10/2026 vem Lucas (`branco`) num
 *    domingo do Tempo Comum (`verde`): quem nomeia o dia é o `sunday_name`.
 *    Já em 01/11/2026 Todos os Santos (`branco`) bate com o dia e vence o
 *    domingo, como manda a precedência de festa principal.
 *
 * Se a cor não vier reconhecível, devolve null e o chamador cai no cálculo
 * local — uma cor errada é pior que a cor calculada aqui.
 */
export function extractDay(payload: unknown, gameId: string): LiturgicalDay | null {
  const node = asRecord(payload)
  if (!node) return null

  const color = parseColor(node.liturgical_color) ?? parseColor(node.color)
  if (!color) return null

  const celebration = asRecord(node.celebration)
  const drivesTheDay = celebration && parseColor(celebration.color) === color
  const fallback = computeLiturgicalDay(gameId)
  const psalm = trimmed(asRecord(asRecord(node.readings)?.psalm)?.reference)

  return {
    color,
    season: trimmed(node.liturgical_season) ?? trimmed(node.season) ?? fallback.season,
    celebration:
      (drivesTheDay ? trimmed(celebration.name) : null) ??
      trimmed(node.sunday_name) ??
      fallback.celebration,
    ...(psalm && { psalm }),
  }
}

async function fromApi(gameId: string): Promise<LiturgicalDay | null> {
  const key = process.env.ORDLE_LITURGY_KEY
  if (!key) return null

  const [year, month, day] = gameId.split('-').map(Number)
  const header = process.env.ORDLE_LITURGY_HEADER || DEFAULT_HEADER
  const prayerBook = process.env.ORDLE_LITURGY_PRAYER_BOOK || DEFAULT_PRAYER_BOOK

  try {
    const res = await $fetch(`${API_BASE}/${year}/${month}/${day}`, {
      headers: { [header]: key, Accept: 'application/json' },
      query: { 'preferences[prayer_book_code]': prayerBook },
      timeout: API_TIMEOUT_MS,
      retry: 0,
    })
    return extractDay(res, gameId)
  } catch {
    // 401 sem credencial, rede fora, timeout — tanto faz, o fallback assume
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

  /**
   * Festas fixas que valem o desvio de cor. `cedeAoDomingo` reproduz a
   * precedência que a API mostra: festa principal (Todos os Santos, Natal)
   * vence o domingo; festa de apóstolo cede a ele — em 18/10/2026 a API
   * devolve verde, não vermelho, porque Lucas caiu num domingo.
   */
  const fixed: Record<string, [LiturgicalDay, cedeAoDomingo?: boolean]> = {
    '01-01': [day('Santa Maria, Mãe de Deus', 'white', 'Natal')],
    '01-06': [day('Epifania do Senhor', 'white', 'Epifania')],
    '06-29': [day('São Pedro e São Paulo', 'red', 'Tempo Comum'), true],
    '07-25': [day('São Tiago, Apóstolo', 'red', 'Tempo Comum'), true],
    '10-18': [day('São Lucas, Evangelista', 'red', 'Tempo Comum'), true],
    '10-28': [day('São Simão e São Judas', 'red', 'Tempo Comum'), true],
    '11-01': [day('Todos os Santos', 'white', 'Tempo Comum')],
    '11-30': [day('Santo André, Apóstolo', 'red', 'Advento'), true],
    '12-25': [day('Natal do Senhor', 'white', 'Natal')],
    '12-26': [day('Santo Estêvão, Protomártir', 'red', 'Natal'), true],
  }
  const feast = fixed[md]
  if (feast && !(feast[1] && isSunday)) return feast[0]

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
