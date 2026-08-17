import type { H3Event } from 'h3'

/**
 * Rate limit em memória: ~30 req/min por IP.
 *
 * Camada 3 da §5.6 — não é à prova de gente determinada (dá pra brutar com
 * cookies novos), só tira a resposta do alcance de quem abre o DevTools por
 * curiosidade. Se rodar serverless com várias instâncias, troque por um KV.
 */
const WINDOW_MS = 60_000
const LIMIT = 30

const hits = new Map<string, number[]>()

export function rateLimit(event: H3Event, key = 'guess') {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    event.node.req.socket.remoteAddress ||
    'unknown'
  const bucket = `${key}:${ip}`
  const now = Date.now()
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(bucket, recent)

  // varredura barata pra Map não crescer sem fim
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
  }

  if (recent.length > LIMIT)
    throw createError({ statusCode: 429, statusMessage: 'rate_limited' })
}
