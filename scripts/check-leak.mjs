#!/usr/bin/env node
/**
 * Regra de ouro da §4: nada de `server/utils/words.ts` pode chegar ao client.
 *
 * Roda depois de `nuxt build` e varre a saída estática atrás de qualquer chave
 * de resposta, de qualquer definição e do dicionário de palpites. Sai com
 * código 1 se achar alguma coisa — dá pra plugar num CI direto.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// o preset padrão gera em .output/public; o da Vercel, em .vercel/output/static
const CANDIDATES = ['.output/public', '.vercel/output/static']

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const dirs = CANDIDATES.filter((d) => existsSync(d))
if (!dirs.length) {
  console.error(`✗ nenhum de ${CANDIDATES.join(', ')} existe — rode \`npm run build\` antes.`)
  process.exit(1)
}

const files = dirs.flatMap(walk)

const bundles = files.map((f) => ({ f, text: readFileSync(f, 'latin1') }))

const source = readFileSync('server/utils/words.ts', 'utf8')
const keys = [...source.matchAll(/key: '([A-Z]{5})'/g)].map((m) => m[1])
const definitions = [...source.matchAll(/definition: '([^']{12,40})/g)].map((m) => m[1])

const findings = []
const hunt = (needle, label) => {
  const hit = bundles.find((b) => b.text.includes(needle))
  if (hit) findings.push(`${label}: "${needle}" em ${hit.f}`)
}

for (const key of keys) hunt(key, 'resposta')
for (const def of definitions) hunt(def, 'definição')
hunt('AAIUN', 'dicionário de palpites') // primeira entrada de pt-5.json

if (findings.length) {
  console.error(`✗ ${findings.length} vazamento(s) no bundle do client:`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `✓ nenhuma das ${keys.length} respostas, nem as definições, nem o dicionário aparecem em ${dirs.join(', ')} (${files.length} arquivos)`,
)
