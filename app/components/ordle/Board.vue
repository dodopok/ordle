<script setup lang="ts">
import type { GameStatus, Mark } from '../../utils/ordle-shared'

const props = defineProps<{
  /** vêm do servidor: no modo difícil a largura é a da palavra do dia */
  wordLength: number
  maxAttempts: number
  guesses: string[]
  results: Mark[][]
  current: string[]
  cursor: number
  status: GameStatus
  shake: boolean
  reveal: number
  win: boolean
}>()

const emit = defineEmits<{ (e: 'select', index: number): void }>()

const rows = computed(() =>
  Array.from({ length: props.maxAttempts }, (_, row) => {
    const guess = props.guesses[row]
    if (guess) return { letters: guess.split(''), marks: props.results[row] ?? null, done: true }
    if (row === props.guesses.length)
      return {
        letters: Array.from({ length: props.wordLength }, (_, i) => props.current[i] ?? ''),
        marks: null,
        done: false,
      }
    return { letters: Array(props.wordLength).fill(''), marks: null, done: false }
  }),
)

/** só a linha em digitação aceita clique, e só com a partida em andamento */
const editable = computed(
  () => props.status === 'playing' && props.guesses.length < props.maxAttempts,
)

const activeRow = computed(() => props.guesses.length)

const liveMessage = computed(() => {
  if (props.status === 'won') return 'Acertou!'
  const last = props.results[props.results.length - 1]
  if (!last) return ''
  const guess = props.guesses[props.guesses.length - 1] ?? ''
  const words: Record<Mark, string> = {
    correct: 'correta',
    present: 'presente',
    absent: 'ausente',
  }
  return last.map((m, i) => `${guess[i]} ${words[m]}`).join(', ')
})
</script>

<template>
  <!--
    As duas medidas do tabuleiro viram custom properties porque o CSS precisa
    delas para dimensionar o tile: a largura disponível se divide por `cols` e
    a altura por `rows`, e no modo difícil os dois mudam.
  -->
  <div
    class="board"
    role="group"
    aria-label="Tabuleiro"
    :style="{ '--ord-cols': wordLength, '--ord-rows': maxAttempts }"
  >
    <div
      v-for="(row, r) in rows"
      :key="r"
      class="board__row"
      :class="{ 'is-shaking': shake && r === activeRow }"
    >
      <OrdleTile
        v-for="(letter, i) in row.letters"
        :key="i"
        :letter="letter"
        :mark="row.marks?.[i] ?? null"
        :index="i"
        :revealing="row.done && r === reveal"
        :bouncing="win && r === guesses.length - 1"
        :interactive="editable && r === activeRow"
        :selected="editable && r === activeRow && i === cursor"
        @select="emit('select', i)"
      />
    </div>
    <p class="ord-sr" aria-live="polite">{{ liveMessage }}</p>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  gap: var(--ord-gap);
  justify-content: center;
  padding: 1rem 0;
}

.board__row {
  display: grid;
  grid-template-columns: repeat(var(--ord-cols), var(--ord-tile));
  gap: var(--ord-gap);
}

.board__row.is-shaking {
  animation: shake 500ms ease;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  15%, 45%, 75% { transform: translateX(-6px); }
  30%, 60%, 90% { transform: translateX(6px); }
}
</style>
