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

const authUser = useState<User | null>('ordle-auth-user', () => null)
const authSession = useState<Session | null>('ordle-auth-session', () => null)
const authReady = useState('ordle-auth-ready', () => false)
const authSyncing = useState('ordle-auth-syncing', () => false)
const authError = useState('ordle-auth-error', () => '')
const authProfile = useState<AccountProfile | null>('ordle-auth-profile', () => null)
const authSyncVersion = useState('ordle-auth-sync-version', () => 0)

let initialized = false
let unsubscribe: (() => void) | undefined

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
  const storage = useOrdleStorage()
  const supabase = getSupabaseClient()

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

  async function syncLocalData() {
    if (!authUser.value || !authSession.value) return
    authSyncing.value = true
    authError.value = ''
    const snapshot = storage.exportSnapshot(authUser.value.id)
    try {
      const response = await $fetch<SyncResponse>('/api/account/sync', {
        method: 'POST',
        headers: headers(),
        body: snapshot,
      })
      applySync(response, authUser.value.id, snapshot.migrationId)
    } catch {
      authError.value = 'Não foi possível sincronizar seus dados ainda.'
    } finally {
      authSyncing.value = false
    }
  }

  async function initialize() {
    if (initialized) return
    initialized = true
    if (!supabase) {
      authReady.value = true
      return
    }

    const { data } = await supabase.auth.getSession()
    authSession.value = data.session
    authUser.value = data.session?.user ?? null
    authReady.value = true
    if (data.session) void syncLocalData()

    const listener = supabase.auth.onAuthStateChange((_event, next) => {
      authSession.value = next
      authUser.value = next?.user ?? null
      if (!next) {
        authProfile.value = null
        return
      }
      // Não encadeia chamadas assíncronas dentro do callback do SDK: deixa o
      // evento terminar antes de consultar a API do Ordle.
      setTimeout(() => void syncLocalData(), 0)
    })
    unsubscribe = () => listener.data.subscription.unsubscribe()
  }

  const requestSync = () => void syncLocalData()

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
    void initialize()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('ordle:sync-needed', requestSync)
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
