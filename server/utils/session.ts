import { createHmac, timingSafeEqual } from 'node:crypto'

export const COOKIE_NAME = 'ordle_s'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 2

export type Session = {
  id: string
  guesses: string[]
  status: 'playing' | 'won' | 'lost'
}

/**
 * Sem banco, sem Redis: o tabuleiro mora num cookie httpOnly assinado com HMAC.
 * O cliente carrega o estado, mas não consegue forjar.
 */
function secret(): string {
  const s = process.env.ORDLE_SECRET
  if (s && s.length >= 16) return s

  // Fail-closed de propósito: a chave de dev é pública (está aqui no repo), e
  // com ela qualquer um forja um cookie com status 'won'. Então ela só vale
  // quando o ambiente diz explicitamente que é dev ou teste — NODE_ENV vazio,
  // 'preview' ou qualquer outra coisa cai no erro, não no atalho.
  if (!isDevLike())
    throw new Error(
      'ORDLE_SECRET ausente ou curto demais (mínimo 16 caracteres). ' +
        'Gere com `openssl rand -base64 32` e configure no ambiente.',
    )
  return 'dev-only-insecure-ordle-secret'
}

const isDevLike = () => {
  const env = process.env.NODE_ENV
  return env === 'development' || env === 'test'
}

const b64 = (s: string) => Buffer.from(s).toString('base64url')

export function seal(data: Session): string {
  const body = b64(JSON.stringify(data))
  const sig = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function unseal(token?: string): Session | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.guesses)) return null
    if (!['playing', 'won', 'lost'].includes(parsed.status)) return null
    return parsed as Session
  } catch {
    return null
  }
}

/**
 * `secure` também é fail-closed: só sai do ar em dev declarado, para o cookie
 * não vazar em http num ambiente que esqueceu de setar NODE_ENV.
 */
export const cookieOptions = () =>
  ({
    httpOnly: true,
    sameSite: 'lax',
    secure: !isDevLike(),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  }) as const
