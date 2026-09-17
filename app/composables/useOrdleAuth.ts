import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '../utils/supabase'
import { useOrdleStorage, type Stats } from './useOrdleStorage'
import type { GameStatus, Mark, Mode } from '../utils/ordle-shared'

export type AccountProfile = {
  userId: string
  publicFirstName: string
  leaderboardOptIn: boolean
}

export type AuthView = {
  enabled: boolean
  ready: boolean
  signedIn: boolean
  profileReady: boolean
  firstName: string
  leaderboardOptIn: boolean
  syncing: boolean
  error: string
}

type CloudGame = {
  gameId: string
  gameNumber: number
  mode: Mode
  wordLength: number
  guesses: string[]
  results: Mark[][]
  status: GameStatus
  answer?: string
  definition?: string
} | null

type SyncResponse = {
  profile: AccountProfile
  stats: Record<Mode, Stats>
  games: Record<Mode, CloudGame>
}

function firstName(user: User): string {
  const metadata = user.user_metadata ?? {}
  const given = typeof metadata.given_name === 'string' ? metadata.given_name.trim() : ''
  if (given) return given.split(/\s+/)[0].slice(0, 32)
  const full =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : ''
  return full.trim().split(/\s+/)[0]?.slice(0, 32) || 'Jogador'
}

export function useOrdleAuth() {
  const authUser = useState<User | null>('ordle-auth-user', () => null)
  const authSession = useState<Session | null>('ordle-auth-session', () => null)
  const authReady = useState('ordle-auth-ready', () => false)
  const authSyncing = useState('ordle-auth-syncing', () => false)
  const authError = useState('ordle-auth-error', () => '')
  const authProfile = useState<AccountProfile | null>('ordle-auth-profile', () => null)
  const authSyncVersion = useState('ordle-auth-sync-version', () => 0)

  let initialized = false
  let unsubscribe: (() => void) | undefined
  const storage = useOrdleStorage()
  const supabase = getSupabaseClient()

  let activeSync: Promise<void> | null = null
  let syncAgain = false

  const headers = () =>
    authSession.value?.access_token
      ? { Authorization: `Bearer ${authSession.value.access_token}` }
      : {}

  function applySync(response: SyncResponse, userId: string, migrationId: string) {
    authProfile.value = response.profile
    for (const mode of ['normal', 'hard'] as Mode[]) {
      storage.saveStats(mode, response.stats[mode])
      const game = response.games[mode]
      if (game) {
        storage.saveGame(mode, {
          ...game,
          answer: game.answer ?? null,
          definition: game.definition ?? null,
        })
      }
    }
    storage.markMigrationComplete(userId, migrationId)
    authSyncVersion.value++
  }

  async function performSync() {
    const user = authUser.value
    const session = authSession.value
    if (!user || !session) return
    authSyncing.value = true
    authError.value = ''
    const snapshot = storage.exportSnapshot(user.id)
    try {
      const response = await $fetch<SyncResponse>('/api/account/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: snapshot,
      })
      // Se a pessoa saiu ou trocou de conta enquanto a requisição estava no
      // ar, a resposta antiga não pode reaparecer no perfil novo.
      if (authUser.value?.id === user.id) applySync(response, user.id, snapshot.migrationId)
    } catch {
      authError.value = 'Não foi possível sincronizar seus dados ainda.'
    } finally {
      authSyncing.value = false
    }
  }

  function syncLocalData(): Promise<void> {
    if (!authUser.value || !authSession.value) return Promise.resolve()
    if (activeSync) {
      syncAgain = true
      return activeSync
    }

    activeSync = performSync()
    const current = activeSync
    const finish = () => {
      if (activeSync !== current) return
      activeSync = null
      if (syncAgain) {
        syncAgain = false
        void syncLocalData()
      }
    }
    void current.then(finish, finish)
    return current
  }

  async function initialize() {
    if (initialized) return
    initialized = true
    if (!supabase) {
      authReady.value = true
      return
    }

    const { data } = await supabase.auth.getSession()
    // O usuário pode existir antes de o perfil retornado pela sincronização.
    // Enquanto isso, não reutilize a inicial de uma sessão anterior.
    authProfile.value = null
    authSession.value = data.session
    authUser.value = data.session?.user ?? null
    authReady.value = true
    if (data.session) void syncLocalData()

    const listener = supabase.auth.onAuthStateChange((_event, next) => {
      const previousUserId = authUser.value?.id
      authSession.value = next
      authUser.value = next?.user ?? null
      if (!next || next.user.id !== previousUserId) {
        authProfile.value = null
      }
      if (!next) {
        return
      }
      // Não encadeia chamadas assíncronas dentro do callback do SDK: deixa o
      // evento terminar antes de consultar a API do Ordle.
      setTimeout(() => void syncLocalData(), 0)
    })
    unsubscribe = () => listener.data.subscription.unsubscribe()
  }

  const requestSync = () => void syncLocalData()
  const onVisibilityChange = () => {
    if (!document.hidden) requestSync()
  }

  async function signInWithGoogle() {
    authError.value = ''
    if (!supabase) {
      authError.value = 'Login ainda não está configurado neste ambiente.'
      return
    }
    const redirectTo = `${window.location.origin}/auth/callback`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) authError.value = 'Não foi possível iniciar o login com Google.'
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    authUser.value = null
    authSession.value = null
    authProfile.value = null
  }

  async function updateProfile(patch: { publicFirstName?: string; leaderboardOptIn?: boolean }) {
    if (!authSession.value) return
    authError.value = ''
    try {
      const response = await $fetch<{ profile: AccountProfile }>('/api/account/profile', {
        method: 'PATCH',
        headers: headers(),
        body: patch,
      })
      authProfile.value = response.profile
    } catch {
      authError.value = 'Não foi possível salvar o perfil.'
    }
  }

  onMounted(() => {
    window.addEventListener('ordle:sync-needed', requestSync)
    window.addEventListener('focus', requestSync)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void initialize()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('ordle:sync-needed', requestSync)
    window.removeEventListener('focus', requestSync)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    unsubscribe?.()
    unsubscribe = undefined
  })

  return {
    enabled: !!supabase,
    user: authUser,
    profile: authProfile,
    ready: authReady,
    syncing: authSyncing,
    error: authError,
    syncVersion: authSyncVersion,
    initialize,
    syncLocalData,
    signInWithGoogle,
    signOut,
    updateProfile,
  }
}
