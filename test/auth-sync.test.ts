import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createFetch } from 'ofetch'
import { useOrdleAuth } from '../app/composables/useOrdleAuth'

const storage = vi.hoisted(() => ({
  exportSnapshot: vi.fn(), saveStats: vi.fn(), saveGame: vi.fn(), markMigrationComplete: vi.fn(),
}))
vi.mock('../app/composables/useOrdleStorage', () => ({ useOrdleStorage: () => storage }))

const snapshot = { migrationId: 'migration-test', history: { normal: [], hard: [] } }
const response = {
  profile: { userId: 'user-test', publicFirstName: 'Teste', leaderboardOptIn: true },
  stats: { normal: {}, hard: {} }, games: { normal: null, hard: null },
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('sincronização da conta', () => {
  let mounted: () => void
  let unmount: () => void
  let fetchSession: ReturnType<typeof vi.fn>
  let fetchApi: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    const states = new Map()
    fetchSession = vi.fn().mockResolvedValue(undefined)
    fetchApi = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('useUserSession', () => ({
      user: ref({ id: 'user-test' }), fetch: fetchSession, clear: vi.fn(),
    }))
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { accountsEnabled: true } }))
    vi.stubGlobal('$fetch', fetchApi)
    vi.stubGlobal('onMounted', (callback: () => void) => { mounted = callback })
    vi.stubGlobal('onBeforeUnmount', (callback: () => void) => { unmount = callback })
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
    storage.exportSnapshot.mockReturnValue(snapshot)
  })
  afterEach(() => {
    unmount?.()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('libera o indicador se a leitura do histórico local falha', async () => {
    storage.exportSnapshot.mockImplementationOnce(() => { throw new Error('storage unavailable') })
    const auth = useOrdleAuth()
    await auth.syncLocalData()
    expect(auth.syncing.value).toBe(false)
    expect(auth.error.value).toContain('Não foi possível sincronizar')
    expect(storage.markMigrationComplete).not.toHaveBeenCalled()
  })

  it('interrompe uma requisição sem resposta e permite tentar de novo', async () => {
    vi.useFakeTimers()
    const network = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    vi.stubGlobal('$fetch', createFetch({ fetch: network }))
    const auth = useOrdleAuth()
    const sync = auth.syncLocalData()
    expect(auth.syncing.value).toBe(true)
    await vi.advanceTimersByTimeAsync(15_000)
    await sync
    expect(auth.syncing.value).toBe(false)
    expect(auth.error.value).toContain('Não foi possível sincronizar')
    expect(network).toHaveBeenCalledTimes(1)
    expect(storage.markMigrationComplete).not.toHaveBeenCalled()

    vi.stubGlobal('$fetch', fetchApi)
    await auth.syncLocalData()
    expect(auth.error.value).toBe('')
    expect(storage.markMigrationComplete).toHaveBeenCalledWith('user-test', 'migration-test')
  })

  it('agrupa montagem, foco e volta à aba em uma única sincronização', async () => {
    const session = deferred<void>()
    fetchSession.mockReturnValue(session.promise)
    const auth = useOrdleAuth()
    mounted()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchSession).toHaveBeenCalledTimes(1)
    session.resolve()
    await flush()
    expect(fetchApi).toHaveBeenCalledTimes(1)
    expect(auth.ready.value).toBe(true)
    expect(auth.syncing.value).toBe(false)
  })

  it('envia dados novos que chegaram durante uma sincronização', async () => {
    const first = deferred<typeof response>()
    fetchApi.mockReturnValueOnce(first.promise)
    const auth = useOrdleAuth()
    mounted()
    await flush()
    const changed = { ...snapshot, history: { normal: [{ gameId: '2026-10-23' }], hard: [] } }
    storage.exportSnapshot.mockReturnValue(changed)
    window.dispatchEvent(new Event('ordle:sync-needed'))
    window.dispatchEvent(new Event('ordle:sync-needed'))
    first.resolve(response)
    await flush()
    expect(fetchApi).toHaveBeenCalledTimes(2)
    expect(fetchApi.mock.calls[1][1].body).toEqual(changed)
    expect(auth.syncing.value).toBe(false)
  })
})
