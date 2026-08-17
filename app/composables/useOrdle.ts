import { MAX_ATTEMPTS, WORD_LENGTH, keyboardState, normalize, type GameStatus, type Mark } from '../utils/ordle-shared'
import { useOrdleStorage, type Stats } from './useOrdleStorage'

type StateResponse = {
  gameId: string
  gameNumber: number
  wordLength: number
  maxAttempts: number
  guesses: string[]
  results: Mark[][]
  status: GameStatus
  nextRolloverAt: number
  liturgicalColor: string
  liturgicalSeason: string
  liturgicalCelebration: string
  answer?: string
  definition?: string
}

type GuessResponse = {
  result: Mark[]
  status: GameStatus
  attemptsLeft: number
  answer?: string
  definition?: string
}

export function useOrdle() {
  const storage = useOrdleStorage()

  const state = reactive({
    gameId: '',
    gameNumber: 0,
    guesses: [] as string[],
    results: [] as Mark[][],
    current: '',
    status: 'playing' as GameStatus,
    answer: null as string | null,
    definition: null as string | null,
    liturgicalColor: 'green',
    liturgicalSeason: '',
    liturgicalCelebration: '',
    nextRolloverAt: 0,
    busy: false,
    ready: false,
    toast: '',
    shake: false,
    reveal: -1, // linha que está virando os tiles
    win: false, // dispara o bounce da linha vencedora
    modal: null as null | 'help' | 'result' | 'settings',
    stats: null as Stats | null,
    rollover: false,
  })

  const keys = computed(() => keyboardState(state.guesses, state.results))
  const canType = computed(() => state.status === 'playing' && !state.busy && state.modal === null)

  async function boot() {
    const cached = storage.loadGame()
    if (cached) {
      // pinta na hora, sem esperar a rede
      Object.assign(state, {
        gameId: cached.gameId,
        gameNumber: cached.gameNumber,
        guesses: cached.guesses,
        results: cached.results,
        status: cached.status,
        answer: cached.answer,
        definition: cached.definition,
      })
    }

    try {
      const server = await $fetch<StateResponse>('/api/ordle/state')
      if (cached && cached.gameId !== server.gameId) storage.clearGame()
      Object.assign(state, {
        gameId: server.gameId,
        gameNumber: server.gameNumber,
        guesses: server.guesses,
        results: server.results,
        status: server.status,
        answer: server.answer ?? null,
        definition: server.definition ?? null,
        liturgicalColor: server.liturgicalColor,
        liturgicalSeason: server.liturgicalSeason,
        liturgicalCelebration: server.liturgicalCelebration,
        nextRolloverAt: server.nextRolloverAt,
        current: '',
        rollover: false,
      })
      storage.saveGame(state)
      if (state.status !== 'playing') {
        state.stats = storage.recordResult(state)
        state.modal = 'result'
      }
    } catch {
      bump('Sem conexão com o servidor')
    } finally {
      state.ready = true
    }
  }

  function type(letter: string) {
    if (!canType.value) return
    if (state.current.length < WORD_LENGTH) state.current += letter
  }

  function backspace() {
    if (!canType.value) return
    state.current = state.current.slice(0, -1)
  }

  async function submit() {
    if (!canType.value) return
    if (state.guesses.length >= MAX_ATTEMPTS) return
    if (state.current.length < WORD_LENGTH) return bump('Faltam letras')

    state.busy = true
    try {
      const r = await $fetch<GuessResponse>('/api/ordle/guess', {
        method: 'POST',
        body: { guess: state.current },
      })
      const row = state.guesses.length
      state.guesses.push(normalize(state.current))
      state.results.push(r.result)
      state.current = ''
      state.status = r.status
      state.reveal = row
      if (r.answer) {
        state.answer = r.answer
        state.definition = r.definition ?? null
      }
      storage.saveGame(state)

      // deixa o flip terminar antes de abrir o modal
      const flipDone = WORD_LENGTH * 100 + 320
      if (state.status === 'won') setTimeout(() => (state.win = true), flipDone)
      if (state.status !== 'playing') {
        state.stats = storage.recordResult(state)
        setTimeout(() => (state.modal = 'result'), flipDone + 900)
      }
    } catch (e: any) {
      const reason = e?.data?.statusMessage ?? e?.statusMessage
      if (reason === 'unknown_word') bump('Palavra não encontrada')
      else if (reason === 'rate_limited') bump('Calma lá, muitas tentativas')
      else if (reason === 'game_over') await boot() // ressincroniza
      else bump('Deu ruim, tenta de novo')
    } finally {
      state.busy = false
    }
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let shakeTimer: ReturnType<typeof setTimeout> | undefined

  function bump(msg: string) {
    state.toast = msg
    state.shake = true
    clearTimeout(shakeTimer)
    clearTimeout(toastTimer)
    shakeTimer = setTimeout(() => (state.shake = false), 500)
    toastTimer = setTimeout(() => (state.toast = ''), 1800)
  }

  // --- virada do dia com a aba aberta -------------------------------------
  let rolloverTimer: ReturnType<typeof setInterval> | undefined

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      backspace()
      return
    }
    // normalize dá conta do teclado ABNT: "ç" vira "C", "á" vira "A"
    const letter = normalize(e.key)
    if (letter.length === 1 && letter >= 'A' && letter <= 'Z') type(letter)
  }

  onMounted(() => {
    boot()
    window.addEventListener('keydown', onKeydown)
    rolloverTimer = setInterval(() => {
      if (state.nextRolloverAt && Date.now() >= state.nextRolloverAt) state.rollover = true
    }, 60_000)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    clearInterval(rolloverTimer)
    clearTimeout(toastTimer)
    clearTimeout(shakeTimer)
  })

  return { state, keys, type, backspace, submit, bump, boot }
}
