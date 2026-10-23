import { createError, getHeader, getRequestURL } from 'h3'

// A sessão agora usa um cookie HttpOnly. Rejeita escritas de outras origens.
export default defineEventHandler((event) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(event.method)) return
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/account/') && path !== '/api/ordle/guess' && path !== '/api/_auth/session') return
  const origin = getHeader(event, 'origin')
  const host = getHeader(event, 'host')
  let foreignOrigin = false
  try {
    foreignOrigin = !!origin && new URL(origin).host !== host
  } catch {
    foreignOrigin = true
  }
  if (getHeader(event, 'sec-fetch-site') === 'cross-site' || foreignOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'invalid_origin' })
  }
})
