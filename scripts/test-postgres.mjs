#!/usr/bin/env node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer, connect } from 'node:net'
import { Transform } from 'node:stream'
import { createApp, eventHandler, toNodeListener, useSession } from 'h3'
import postgres from 'postgres'

const url = new URL(process.env.DATABASE_URL || 'postgresql://localhost/missing')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.startsWith('/ordle_test')) {
  throw new Error('Use somente um banco local de teste chamado ordle_test*.')
}
const sql = postgres(url.href, { max: 4, onnotice: () => {},
  types: { date: { to: 1082, from: [1082], serialize: String, parse: String } },
})
const id = randomUUID()
const subject = `local-test-${id}`
const password = randomUUID() + randomUUID()
let app
let signer
let proxy
const sockets = new Set()
let logs = ''
try {
  await sql.unsafe(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'))
  await sql`insert into ordle_users (id, google_sub, first_name) values (${id}, ${subject}, 'Teste')`
  const [sameAccount] = await sql`insert into ordle_users (google_sub, first_name)
    values (${subject}, 'Teste') on conflict (google_sub) do update set first_name = excluded.first_name
    returning id`
  assert.equal(sameAccount.id, id, 'login Google deve preservar o UUID migrado')

  // Assina apenas uma sessão de teste local com o mesmo formato da biblioteca;
  // não acrescenta nenhuma rota de teste à aplicação de produção.
  const signingApp = createApp().use(eventHandler(async (event) => {
    const session = await useSession(event, { name: 'ordle-account', password })
    await session.update({ user: { id, firstName: 'Teste' } })
    return { ok: true }
  }))
  signer = createServer(toNodeListener(signingApp))
  await new Promise((resolve) => signer.listen(0, '127.0.0.1', resolve))
  const signed = await fetch(`http://127.0.0.1:${signer.address().port}`)
  const cookie = signed.headers.get('set-cookie').split(';')[0]
  assert.match(signed.headers.get('set-cookie'), /HttpOnly/i)

  // 60 ms de ida e volta entre aplicação e banco: o custo do histórico não
  // pode crescer uma transação de rede para cada partida já sincronizada.
  const delay = () => new Transform({
    transform(chunk, _encoding, done) { setTimeout(() => done(null, chunk), 30) },
  })
  proxy = createTcpServer((client) => {
    const upstream = connect({ host: url.hostname, port: Number(url.port || 5432) })
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => { client.destroy(); upstream.destroy() })
    }
    client.pipe(delay()).pipe(upstream)
    upstream.pipe(delay()).pipe(client)
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const appDatabaseUrl = new URL(url)
  appDatabaseUrl.port = String(proxy.address().port)

  const base = 'http://127.0.0.1:3098'
  app = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '3098', DATABASE_URL: appDatabaseUrl.href,
      ORDLE_SECRET: password, NUXT_SESSION_PASSWORD: password,
      NUXT_PUBLIC_ACCOUNTS_ENABLED: 'true',
      NUXT_OAUTH_GOOGLE_CLIENT_ID: 'local-test',
      NUXT_OAUTH_GOOGLE_CLIENT_SECRET: 'local-test',
      NUXT_OAUTH_GOOGLE_REDIRECT_URL: `${base}/auth/google`,
    }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout.on('data', (chunk) => { logs += chunk })
  app.stderr.on('data', (chunk) => { logs += chunk })
  let ready = false
  for (let i = 0; i < 50; i++) {
    try { ready = (await fetch(`${base}/api/_auth/session`)).ok } catch {}
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, `servidor não iniciou: ${logs}`)
  const request = (path, body, method = 'POST', extra = {}, signal) => fetch(base + path, {
    method, headers: { cookie, 'content-type': 'application/json', ...extra },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal,
  })
  assert.equal((await fetch(`${base}/api/account/profile`, { method: 'PATCH' })).status, 401)
  assert.equal((await request('/api/account/profile', {}, 'PATCH', { origin: 'https://other.example' })).status, 403)
  const authStart = await fetch(`${base}/auth/google`, { redirect: 'manual' })
  assert.equal(authStart.status, 302)
  const authUrl = new URL(authStart.headers.get('location'))
  assert.equal(authUrl.origin, 'https://accounts.google.com')
  assert.ok(authUrl.searchParams.get('state'))
  const badCallback = await fetch(`${base}/auth/google?code=fake&state=fake`, { redirect: 'manual' })
  assert.equal(badCallback.headers.get('location'), '/auth/callback?error=state')

  const snapshot = { v: 1, migrationId: 'ordle-test-migration', deviceId: 'ordle-test-device',
    stats: {
      normal: { played: 2, wins: 1, streak: 1, maxStreak: 1, distribution: [1, 0, 0, 0, 0, 0] },
      hard: { played: 0, wins: 0, streak: 0, maxStreak: 0, distribution: [0, 0, 0, 0, 0, 0, 0] },
    }, games: { normal: null, hard: null }, history: { normal: [], hard: [] },
    prefs: { v: 1, theme: 'system', highContrast: false, sound: true, mode: 'normal' },
  }
  const sync = await request('/api/account/sync', snapshot)
  assert.equal(sync.status, 200, await sync.clone().text())
  assert.equal((await sync.json()).profile.userId, id)
  const again = await request('/api/account/sync', snapshot)
  assert.equal((await again.json()).stats.normal.played, 2, 'snapshot não pode contar duas vezes')
  const state = await (await request('/api/ordle/state?mode=normal', undefined, 'GET')).json()
  assert.equal(state.status, 'playing')
  assert.equal(state.answer, undefined, 'resposta não pode vazar antes de terminar')
  const guess = await request('/api/ordle/guess', { guess: 'SALMO', mode: 'normal' })
  assert.equal(guess.status, 200, await guess.clone().text())
  assert.equal((await guess.json()).syncPending, false)
  const [saved] = await sql`select * from ordle_player_games where user_id=${id} and game_id=${state.gameId} and mode='normal'`
  assert.deepEqual(saved.guesses, ['SALMO'])
  const resync = await request('/api/account/sync', { ...snapshot,
    games: { normal: { gameId: state.gameId, mode: 'normal', guesses: [], updatedAt: new Date().toISOString() }, hard: null },
  })
  assert.deepEqual((await resync.json()).games.normal.guesses, ['SALMO'], 'snapshot não deve sobrescrever a gravação do servidor')

  const history = Array.from({ length: 50 }, (_, index) => ({
    gameId: new Date(Date.UTC(2026, 7, 18 + index)).toISOString().slice(0, 10),
    mode: 'normal', guesses: ['SALMO'], updatedAt: '2026-10-23T12:00:00Z',
  }))
  const largeSnapshot = { ...snapshot, history: { normal: history, hard: [] } }
  const syncStarted = performance.now()
  const bulk = await request('/api/account/sync', largeSnapshot, 'POST', {}, AbortSignal.timeout(6000))
  assert.equal(bulk.status, 200, await bulk.clone().text())
  const bulkMs = Math.round(performance.now() - syncStarted)
  const [imported] = await sql`select count(*)::int as count from ordle_player_games where user_id=${id} and source='imported'`
  assert.equal(imported.count, history.length)
  const beforeRepeat = await sql`select game_id, guesses, status, updated_at, xmin::text as version
    from ordle_player_games where user_id=${id} order by game_id, mode`
  const repeats = await Promise.all([
    request('/api/account/sync', largeSnapshot),
    request('/api/account/sync', { ...largeSnapshot, history: { normal: [...history].reverse(), hard: [] } }),
  ])
  for (const repeated of repeats) assert.equal(repeated.status, 200, await repeated.clone().text())
  const afterRepeat = await sql`select game_id, guesses, status, updated_at, xmin::text as version
    from ordle_player_games where user_id=${id} order by game_id, mode`
  assert.deepEqual(afterRepeat, beforeRepeat, 'snapshots idênticos concorrentes não devem regravar as partidas')

  // Um jogo encerrado prevalece sobre progresso parcial mais recente.
  const ended = { ...history[0], guesses: Array(6).fill('LIVRO') }
  const terminal = await request('/api/account/sync', { ...snapshot, history: { normal: [ended], hard: [] } })
  assert.equal(terminal.status, 200)
  const stale = await request('/api/account/sync', { ...snapshot,
    history: { normal: [{ ...history[0], updatedAt: '2026-10-23T13:00:00Z' }], hard: [] },
  })
  assert.equal(stale.status, 200)
  const [preserved] = await sql`select status, guesses from ordle_player_games
    where user_id=${id} and game_id=${history[0].gameId} and mode='normal'`
  assert.equal(preserved.status, 'lost')
  assert.deepEqual(preserved.guesses, ended.guesses)

  const [before] = await sql`select played from ordle_stats where user_id=${id} and mode='normal'`
  const finish = () => sql`select ordle_record_server_game(${id}::uuid, '2026-08-17'::date,
    'normal', ${sql.json(['SALMO', 'CREDO'])}, 'won', 2, 5, now())`
  await Promise.all([finish(), finish()])
  const [after] = await sql`select played from ordle_stats where user_id=${id} and mode='normal'`
  assert.equal(after.played, before.played + 1, 'duas conclusões simultâneas contam uma partida')
  await sql`select ordle_record_server_game(${id}::uuid, '2026-08-17'::date, 'normal',
    ${sql.json(['ERRAR'])}, 'lost', 6, 0, now())`
  const [final] = await sql`select status,guesses from ordle_player_games
    where user_id=${id} and game_id='2026-08-17' and mode='normal'`
  assert.equal(final.status, 'won')
  assert.deepEqual(final.guesses, ['SALMO', 'CREDO'])
  await sql`select ordle_record_server_game(${id}::uuid, '2026-08-17'::date, 'hard',
    ${sql.json(['A', 'B', 'C', 'D', 'E', 'F', 'G'])}, 'won', 7, 1, now())`
  const [hard] = await sql`select distribution from ordle_stats where user_id=${id} and mode='hard'`
  assert.deepEqual(hard.distribution, [0, 0, 0, 0, 0, 0, 1])
  const rename = await request('/api/account/profile', { publicFirstName: 'Pessoa Teste', leaderboardOptIn: false }, 'PATCH')
  assert.equal(rename.status, 200)
  assert.equal((await rename.json()).profile.publicFirstName, 'Pessoa')
  const ranking = await (await fetch(`${base}/api/ranking`)).json()
  assert.equal(ranking.entries.some((entry) => entry.firstName === 'Pessoa'), false)
  assert.equal((await request('/api/_auth/session', undefined, 'DELETE')).status, 200)
  console.log(`✓ Sincronização de 50 partidas em ${bulkMs} ms com 60 ms de latência, sem regravações e com precedência preservada`)
  console.log('✓ Google UUID, sessão HttpOnly, autorização, origem, OAuth state, sync idempotente, gravação, concorrência, modos e privacidade do ranking')
} finally {
  app?.kill()
  if (signer) await new Promise((resolve) => signer.close(resolve))
  for (const socket of sockets) socket.destroy()
  if (proxy) await new Promise((resolve) => proxy.close(resolve))
  await sql`delete from ordle_users where id=${id}`
  await sql.end()
}
