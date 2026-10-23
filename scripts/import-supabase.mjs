#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import postgres from 'postgres'

// Use apenas com o banco exclusivo e vazio do Ordle. Nunca altera a origem.
const file = process.argv[2]
if (!file || !process.env.DATABASE_URL) {
  throw new Error('Uso: DATABASE_URL=... node scripts/import-supabase.mjs export.json')
}
const data = JSON.parse(await readFile(file, 'utf8'))
const tables = [
  ['ordle_users', 'users'], ['ordle_profiles', 'profiles'], ['ordle_stats', 'stats'],
  ['ordle_player_games', 'games'], ['ordle_legacy_imports', 'imports'],
]
if (data.version !== 1 || tables.some(([, key]) => !Array.isArray(data[key]))) {
  throw new Error('Exportação inválida')
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
try {
  await sql.begin(async (tx) => {
    const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
    await tx.unsafe(schema)
    for (const [table] of tables) {
      const [count] = await tx`select count(*)::integer as total from ${tx(table)}`
      if (count.total) throw new Error(`Destino não está vazio: ${table}. Importação cancelada.`)
    }
    for (const [table, key] of tables) {
      if (!data[key].length) continue
      await tx`insert into ${tx(table)} select * from jsonb_populate_recordset(null::${tx(table)}, ${tx.json(data[key])})`
      // Verifica todos os campos, inclusive UUID, datas, preferências e recibos
      // da migração local, que impedem contabilizar estatísticas duas vezes.
      const [actual] = await tx`select jsonb_agg(to_jsonb(t)) as rows from ${tx(table)} t`
      const keyFor = (row) => table === 'ordle_users' ? row.id
        : table === 'ordle_profiles' ? row.user_id
        : table === 'ordle_legacy_imports' ? row.id
        : `${row.user_id}:${row.mode}:${row.game_id ?? ''}`
      const sort = (rows) => [...rows].sort((a, b) => keyFor(a).localeCompare(keyFor(b)))
      // Timestamps podem ter representações equivalentes (+00:00 / Z).
      const normalize = (rows) => sort(rows).map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key,
          value && /(_at)$/.test(key) ? new Date(value).toISOString() : value,
        ]),
      ))
      if (!isDeepStrictEqual(normalize(actual.rows), normalize(data[key]))) {
        throw new Error(`Verificação falhou: ${table}. Transação revertida.`)
      }
    }
  })
  console.log(JSON.stringify({ imported: Object.fromEntries(tables.map(([, key]) => [key, data[key].length])) }))
} finally {
  await sql.end()
}
