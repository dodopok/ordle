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

export function useOrdleAuth() {
  const { user: authUser, fetch: fetchSession, clear: clearSession } = useUserSession()
  const authReady = useState('ordle-auth-ready', () => false)
  const authSyncing = useState('ordle-auth-syncing', () => false)
  const authError = useState('ordle-auth-error', () => '')
  const authProfile = useState<AccountProfile | null>('ordle-auth-profile', () => null)
  const authSyncVersion = useState('ordle-auth-sync-version', () => 0)

  let initialized = false
  const storage = useOrdleStorage()
  const enabled = !!useRuntimeConfig().public.accountsEnabled

  let activeSync: Promise<void> | null = null
  let activeRefresh: Promise<void> | null = null
  let syncAgain = false

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
    if (!user) return
    authSyncing.value = true
    authError.value = ''
    try {
      const snapshot = storage.exportSnapshot(user.id)
      const response = await $fetch<SyncResponse>('/api/account/sync', {
        method: 'POST',
        body: snapshot,
        timeout: 15_000,
        retry: 0,
      })
      // Se a pessoa saiu ou trocou de conta enquanto a requisição estava no
      // ar, a resposta antiga não pode reaparecer no perfil novo.
      if (authUser.value?.id === user.id && response.profile.userId === user.id)
        applySync(response, user.id, snapshot.migrationId)
    } catch {
      authError.value = 'Não foi possível sincronizar seus dados ainda.'
    } finally {
      authSyncing.value = false
    }
  }

  function syncLocalData(): Promise<void> {
    if (!authUser.value) return Promise.resolve()
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

  function refreshAccount(): Promise<void> {
    if (!enabled) return Promise.resolve()
    // Voltar ao app dispara focus e visibilitychange juntos em alguns browsers.
    if (activeRefresh) return activeRefresh
    const current = (async () => {
      try {
        const previousUserId = authUser.value?.id
        await fetchSession()
        if (authUser.value?.id !== previousUserId) authProfile.value = null
        await syncLocalData()
      } catch {
        authError.value = 'Não foi possível atualizar sua conta ainda.'
      }
    })()
    activeRefresh = current
    void current.then(() => {
      if (activeRefresh === current) activeRefresh = null
    })
    return current
  }

  async function initialize() {
    if (initialized) return
    initialized = true
    try {
      await refreshAccount()
    } finally {
      authReady.value = true
    }
  }

  const requestSync = () => void refreshAccount()
  const onDataChange = () => void syncLocalData()
  const onVisibilityChange = () => {
    if (!document.hidden) requestSync()
  }

  async function signInWithGoogle() {
    authError.value = ''
    if (!enabled) {
      authError.value = 'Login ainda não está configurado neste ambiente.'
      return
    }
    await navigateTo('/auth/google', { external: true })
  }

  async function signOut() {
    await clearSession()
    authProfile.value = null
  }

  async function updateProfile(patch: { publicFirstName?: string; leaderboardOptIn?: boolean }) {
    if (!authUser.value) return
    authError.value = ''
    try {
      const response = await $fetch<{ profile: AccountProfile }>('/api/account/profile', {
        method: 'PATCH',
        body: patch,
        timeout: 15_000,
        retry: 0,
      })
      authProfile.value = response.profile
    } catch {
      authError.value = 'Não foi possível salvar o perfil.'
    }
  }

  onMounted(() => {
    window.addEventListener('ordle:sync-needed', onDataChange)
    window.addEventListener('focus', requestSync)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void initialize()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('ordle:sync-needed', onDataChange)
    window.removeEventListener('focus', requestSync)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    enabled,
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
