import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WORD_LENGTH,
  MAX_ATTEMPTS,
  keyboardState,
  normalize,
  type GameStatus,
  type Mark,
  type Mode,
} from '../utils/ordle-shared'
import { useOrdleStorage, type Stats } from './useOrdleStorage'

type StateResponse = {
  gameId: string
  gameNumber: number
  mode: Mode
  wordLength: number
  maxAttempts: number
  guesses: string[]
  results: Mark[][]
  status: GameStatus
  nextRolloverAt: number
  liturgicalColor: string
  liturgicalSeason: string
  liturgicalCelebration: string
  liturgicalPsalm: string | null
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

export function useOrdle(initialMode: Mode = 'normal') {
  const storage = useOrdleStorage()

  // Cada boot tem um número próprio. Se a pessoa trocar de modo enquanto uma
  // resposta antiga ainda está no ar, a resposta antiga não pode redesenhar o
  // jogo por cima do modo que está selecionado agora.
  let bootVersion = 0

  const state = reactive({
    gameId: '',
    gameNumber: 0,
    mode: initialMode,
    /**
     * Comprimento e tentativas vêm do servidor, não de constante: no modo
     * difícil a largura do tabuleiro é a da palavra do dia, de 6 a 8.
     */
    wordLength: DEFAULT_WORD_LENGTH,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    guesses: [] as string[],
    results: [] as Mark[][],
    /**
     * A linha em digitação, uma célula por posição. É array e não string
     * porque dá para clicar num quadrado e preencher fora de ordem — com
     * string não haveria como representar "___O_".
     */
    current: Array<string>(DEFAULT_WORD_LENGTH).fill(''),
    cursor: 0,
    status: 'playing' as GameStatus,
    answer: null as string | null,
    definition: null as string | null,
    liturgicalColor: 'green',
    liturgicalSeason: '',
    liturgicalCelebration: '',
    liturgicalPsalm: null as string | null,
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

  const emptyRow = () => Array<string>(state.wordLength).fill('')

  const keys = computed(() => keyboardState(state.guesses, state.results))
  const canType = computed(
    () => state.ready && state.status === 'playing' && !state.busy && state.modal === null,
  )

  const cachedWordLength = (mode: Mode, cached: ReturnType<typeof storage.loadGame>) => {
    if (mode === 'normal') return DEFAULT_WORD_LENGTH
    const length = cached?.wordLength ?? cached?.guesses.find(Boolean)?.length
    return length && length >= 6 && length <= 8 ? length : null
  }

  async function boot(requestedMode: Mode = state.mode) {
    const version = ++bootVersion
    const cached = storage.loadGame(requestedMode)
    const length = cachedWordLength(requestedMode, cached)

    state.ready = false

    // O normal sempre tem cinco casas. Isso também corrige imediatamente uma
    // largura antiga do difícil que tenha ficado na memória antes da resposta
    // do servidor chegar.
    if (state.mode === requestedMode) {
      Object.assign(state, {
        mode: requestedMode,
        wordLength: length ?? DEFAULT_WORD_LENGTH,
        maxAttempts: MAX_ATTEMPTS[requestedMode],
        current: Array<string>(length ?? DEFAULT_WORD_LENGTH).fill(''),
        cursor: 0,
      })
    }

    if (cached) {
      // pinta na hora, sem esperar a rede
      // No difícil, uma entrada antiga sem `wordLength` só é reaproveitada se
      // o tamanho puder ser inferido de um palpite já feito.
      if (length) {
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
    }

    try {
      const server = await $fetch<StateResponse>('/api/ordle/state', {
        query: { mode: requestedMode },
      })

      // Uma troca de modo iniciou outro boot enquanto este aguardava a rede.
      // Aplicar esta resposta misturaria a largura de um jogo com o rótulo do
      // outro, que é justamente o estado impossível que aparece no celular.
      if (version !== bootVersion || state.mode !== requestedMode) return

      if (cached && cached.gameId !== server.gameId) storage.clearGame(requestedMode)
      Object.assign(state, {
        gameId: server.gameId,
        gameNumber: server.gameNumber,
        mode: server.mode,
        wordLength: server.wordLength,
        maxAttempts: server.maxAttempts,
        guesses: server.guesses,
        results: server.results,
        status: server.status,
        answer: server.answer ?? null,
        definition: server.definition ?? null,
        liturgicalColor: server.liturgicalColor,
        liturgicalSeason: server.liturgicalSeason,
        liturgicalCelebration: server.liturgicalCelebration,
        liturgicalPsalm: server.liturgicalPsalm ?? null,
        nextRolloverAt: server.nextRolloverAt,
        // depois de `wordLength`, que é quem dita o tamanho da linha
        current: Array<string>(server.wordLength).fill(''),
        cursor: 0,
        rollover: false,
      })
      storage.saveGame(requestedMode, state)
      if (state.status !== 'playing') {
        state.stats = storage.recordResult(requestedMode, state)
        state.modal = 'result'
      }
    } catch {
      if (version === bootVersion && state.mode === requestedMode) bump('Sem conexão com o servidor')
    } finally {
      if (version === bootVersion && state.mode === requestedMode) state.ready = true
    }
  }

  /**
   * Troca de modo é partida diferente: zera o tabuleiro e busca o estado do
   * outro jogo. O servidor guarda os dois em cookies separados, então voltar
   * para o normal recupera a partida de lá do jeito que ela estava.
   */
  async function setMode(mode: Mode) {
    if (mode === state.mode || state.busy) return
    state.mode = mode
    state.ready = false
    const cached = storage.loadGame(mode)
    const length = cachedWordLength(mode, cached)
    Object.assign(state, {
      wordLength: length ?? DEFAULT_WORD_LENGTH,
      maxAttempts: MAX_ATTEMPTS[mode],
      guesses: [],
      results: [],
      current: Array<string>(length ?? DEFAULT_WORD_LENGTH).fill(''),
      cursor: 0,
      status: 'playing' as GameStatus,
      answer: null,
      definition: null,
      reveal: -1,
      win: false,
    })
    // o modal aberto continua aberto: quem clicou no interruptor dentro das
    // configurações vê a estatística trocar para a do outro modo, em vez de o
    // painel sumir na cara. Se a partida do modo novo já acabou, o `boot`
    // abre o resultado por cima, que é o certo.
    await boot(mode)
  }

  /**
   * Próxima célula vazia a partir de `from`, dando a volta na linha. Se a
   * linha estiver cheia, fica onde está — aí digitar sobrescreve, que é o
   * comportamento previsível de uma grade com cursor.
   */
  function nextEmpty(from: number): number {
    for (let i = 0; i < state.wordLength; i++) {
      const idx = (from + i) % state.wordLength
      if (!state.current[idx]) return idx
    }
    return Math.min(from, state.wordLength - 1)
  }

  /** Move o cursor para um quadrado específico (clique no tabuleiro). */
  function focusCell(index: number) {
    if (!canType.value) return
    if (index < 0 || index >= state.wordLength) return
    state.cursor = index
  }

  function type(letter: string) {
    if (!canType.value) return
    state.current[state.cursor] = letter
    state.cursor = nextEmpty(state.cursor + 1)
  }

  /**
   * Apaga a célula do cursor; se ela já estiver vazia, apaga a letra
   * preenchida mais próxima à esquerda, dando a volta na linha.
   *
   * A volta importa: depois de preencher a última casa o cursor volta para o
   * começo, e um backspace que só olhasse para `cursor - 1` não apagaria nada
   * ali — o jogador aperta ⌫ e a tela não reage. Com a linha não vazia, ⌫
   * sempre tira alguma letra.
   */
  function backspace() {
    if (!canType.value) return
    if (state.current[state.cursor]) {
      state.current[state.cursor] = ''
      return rewindIfEmpty()
    }
    for (let i = 1; i <= state.wordLength; i++) {
      const idx = (state.cursor - i + state.wordLength * 2) % state.wordLength
      if (state.current[idx]) {
        state.current[idx] = ''
        state.cursor = idx
        return rewindIfEmpty()
      }
    }
  }

  /**
   * Linha vazia volta a começar do zero. Sem isso o cursor fica onde a última
   * letra foi apagada e, como ele dá a volta ao chegar no fim, digitar uma
   * palavra inteira a partir do meio sairia embaralhada: com o cursor em 3,
   * "SALM" viraria "LM_SA".
   */
  function rewindIfEmpty() {
    if (state.current.every((c) => !c)) state.cursor = 0
  }

  function moveCursor(delta: number) {
    if (!canType.value) return
    state.cursor = Math.min(state.wordLength - 1, Math.max(0, state.cursor + delta))
  }

  async function submit() {
    if (!canType.value) return
    if (state.guesses.length >= state.maxAttempts) return

    const guess = state.current.join('')
    // com preenchimento fora de ordem dá para deixar buraco no meio, então
    // não basta contar o tamanho: tem que checar célula por célula
    if (guess.length < state.wordLength) {
      state.cursor = nextEmpty(0)
      return bump('Faltam letras')
    }

    state.busy = true
    try {
      const r = await $fetch<GuessResponse>('/api/ordle/guess', {
        method: 'POST',
        body: { guess, mode: state.mode },
      })
      const row = state.guesses.length
      state.guesses.push(normalize(guess))
      state.results.push(r.result)
      state.current = emptyRow()
      state.cursor = 0
      state.status = r.status
      state.reveal = row
      if (r.answer) {
        state.answer = r.answer
        state.definition = r.definition ?? null
      }
      storage.saveGame(state.mode, state)

      // deixa o flip terminar antes de abrir o modal
      const flipDone = state.wordLength * 100 + 320
      if (state.status === 'won') setTimeout(() => (state.win = true), flipDone)
      if (state.status !== 'playing') {
        state.stats = storage.recordResult(state.mode, state)
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
    // as setas andam pela linha, par natural do clique no quadrado
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      moveCursor(e.key === 'ArrowLeft' ? -1 : 1)
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

  return { state, keys, type, backspace, submit, bump, boot, focusCell, moveCursor, setMode }
}
