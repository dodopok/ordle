<script setup lang="ts">
import type { Mark } from '../../utils/ordle-shared'

const props = defineProps<{
  letter: string
  mark?: Mark | null
  /** índice na linha, usado para escalonar flip e bounce */
  index: number
  revealing?: boolean
  bouncing?: boolean
  /** na linha em digitação o quadrado é clicável: leva o cursor para ele */
  interactive?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{ (e: 'select'): void }>()

const LABEL: Record<Mark, string> = {
  correct: 'letra correta',
  present: 'letra presente em outra posição',
  absent: 'letra ausente',
}

const ariaLabel = computed(() => {
  const posicao = `posição ${props.index + 1}`
  if (props.interactive) return props.letter ? `${posicao}, ${props.letter}` : `${posicao}, vazia`
  if (!props.letter) return 'vazio'
  if (!props.mark) return props.letter
  return `${props.letter}, ${LABEL[props.mark]}`
})

/**
 * Roving tabindex: só o quadrado selecionado é tabulável, e o foco segue o
 * cursor quando ele já está dentro da linha. Sem isso o foco do DOM e o cursor
 * divergem — dá para ver dois quadrados marcados ao mesmo tempo, um pelo
 * clique e outro pelo cursor.
 */
const btn = ref<HTMLButtonElement | null>(null)

watch(
  () => props.selected,
  (selected) => {
    if (!selected || !btn.value) return
    const active = document.activeElement
    // só rouba o foco se ele já estava num quadrado: nunca no load nem quando
    // o jogador está usando o teclado da tela
    if (active instanceof HTMLElement && active.classList.contains('tile--btn'))
      btn.value.focus({ preventScroll: true })
  },
)

const classes = computed(() => [
  props.mark ? `is-${props.mark}` : props.letter ? 'is-filled' : '',
  {
    'is-revealing': props.revealing,
    'is-bouncing': props.bouncing,
    'is-selected': props.selected,
  },
])
</script>

<template>
  <!--
    Na linha em digitação o quadrado vira botão de verdade, para funcionar com
    teclado e leitor de tela. Enter e espaço são barrados aqui porque o
    tratador global da janela já cuida deles (Enter envia o palpite) — sem
    isso, Enter com foco num quadrado enviaria e re-selecionaria o quadrado.
  -->
  <button
    v-if="interactive"
    ref="btn"
    type="button"
    class="tile tile--btn"
    :class="classes"
    :style="{ '--i': index }"
    :aria-label="ariaLabel"
    :aria-current="selected ? 'true' : undefined"
    :tabindex="selected ? 0 : -1"
    @click="emit('select')"
    @keydown.enter.prevent
    @keydown.space.prevent
  >
    <span class="tile__face">{{ letter }}</span>
  </button>

  <div
    v-else
    class="tile"
    :class="classes"
    :style="{ '--i': index }"
    role="img"
    :aria-label="ariaLabel"
  >
    <span class="tile__face">{{ letter }}</span>
  </div>
</template>

<style scoped>
.tile {
  width: var(--ord-tile);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 2px solid var(--ord-rule);
  background: var(--ord-surface);
  font-family: var(--ord-display);
  font-weight: 600;
  font-size: calc(var(--ord-tile) * 0.55);
  line-height: 1;
  letter-spacing: 0.06em;
  text-indent: 0.06em; /* compensa o tracking pra letra ficar centrada */
  color: var(--ord-ink);
  user-select: none;
}

/* o botão precisa zerar o estilo próprio para virar tile */
.tile--btn {
  padding: 0;
  margin: 0;
  font-family: var(--ord-display);
  cursor: pointer;
  appearance: none;
}

.tile.is-filled {
  border-color: var(--ord-absent);
  animation: pop 100ms ease-out;
}

/*
 * O cursor: borda na cor do dia e um filete embaixo. Não uso fundo colorido
 * porque as três cores de feedback têm que continuar sendo as únicas coisas
 * pintadas no tabuleiro.
 */
.tile.is-selected {
  border-color: var(--ord-accent);
  box-shadow: inset 0 -3px 0 var(--ord-accent);
}

/*
 * Com o roving tabindex, o quadrado focado é sempre o selecionado — os dois
 * indicadores coincidem em vez de brigar. O anel fica: sem ele, quem chega no
 * tabuleiro pelo Tab não teria como saber que chegou.
 */
.tile--btn:focus { outline: none; }

.tile--btn:focus-visible {
  outline: 2px solid var(--ord-accent);
  outline-offset: 2px;
}

.tile.is-correct { background: var(--ord-correct); border-color: var(--ord-correct); color: #fff; }
.tile.is-present { background: var(--ord-present); border-color: var(--ord-present); color: #fff; }
.tile.is-absent { background: var(--ord-absent); border-color: var(--ord-absent); color: #fff; }

.tile.is-revealing {
  animation: flip 300ms ease-in-out backwards;
  animation-delay: calc(var(--i) * 100ms);
}

.tile.is-bouncing {
  animation: bounce 400ms ease;
  animation-delay: calc(var(--i) * 100ms);
}

@keyframes pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.06); }
  100% { transform: scale(1); }
}

/* a cor entra aos 50% do flip, quando o tile está de canto pro observador */
@keyframes flip {
  0% { transform: rotateX(0); background: var(--ord-surface); border-color: var(--ord-rule); color: var(--ord-ink); }
  49% { transform: rotateX(90deg); background: var(--ord-surface); border-color: var(--ord-rule); color: var(--ord-ink); }
  50% { transform: rotateX(90deg); }
  100% { transform: rotateX(0); }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  40% { transform: translateY(-16px); }
  70% { transform: translateY(-6px); }
}

@media (prefers-reduced-motion: reduce) {
  /* sem flip: a cor aparece direto */
  .tile.is-revealing,
  .tile.is-bouncing,
  .tile.is-filled {
    animation: none;
  }
}
</style>
