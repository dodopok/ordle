<script setup lang="ts">
import type { Mark } from '../../utils/ordle-shared'

const props = defineProps<{
  letter: string
  mark?: Mark | null
  /** índice na linha, usado para escalonar flip e bounce */
  index: number
  revealing?: boolean
  bouncing?: boolean
}>()

const LABEL: Record<Mark, string> = {
  correct: 'letra correta',
  present: 'letra presente em outra posição',
  absent: 'letra ausente',
}

const ariaLabel = computed(() => {
  if (!props.letter) return 'vazio'
  if (!props.mark) return props.letter
  return `${props.letter}, ${LABEL[props.mark]}`
})
</script>

<template>
  <div
    class="tile"
    :class="[
      mark ? `is-${mark}` : letter ? 'is-filled' : '',
      { 'is-revealing': revealing, 'is-bouncing': bouncing },
    ]"
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

.tile.is-filled {
  border-color: var(--ord-absent);
  animation: pop 100ms ease-out;
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
