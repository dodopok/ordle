import postgres from 'postgres'
import { createError } from 'h3'

let connection: ReturnType<typeof postgres> | undefined

export function accountDatabase() {
  if (!connection) {
    const url = String(process.env.DATABASE_URL || useRuntimeConfig().databaseUrl || '')
    if (!url) throw createError({ statusCode: 503, statusMessage: 'account_not_configured' })
    connection = postgres(url, {
      max: 3,
      idle_timeout: 10,
      connect_timeout: 10,
      max_lifetime: 60 * 5,
      // Datas dos jogos são datas civis de São Paulo, nunca timestamps UTC.
      types: {
        date: { to: 1082, from: [1082], serialize: String, parse: String },
        timestamp: { to: 1184, from: [1184],
          serialize: (value: string | Date) => new Date(value).toISOString(),
          parse: (value: string) => new Date(value).toISOString(),
        },
      },
    })
  }
  return connection
}

export async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'account_database_error' })
  }
}
