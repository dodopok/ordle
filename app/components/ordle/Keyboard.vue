<script setup lang="ts">
import type { Mark } from '../../utils/ordle-shared'

defineProps<{ keys: Record<string, Mark>; disabled?: boolean }>()

const emit = defineEmits<{
  (e: 'type', letter: string): void
  (e: 'backspace'): void
  (e: 'submit'): void
}>()

const ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
]

const label = (k: string) => (k === 'ENTER' ? '⏎' : k === 'BACK' ? '⌫' : k)
const aria = (k: string) => (k === 'ENTER' ? 'Enviar' : k === 'BACK' ? 'Apagar' : `Letra ${k}`)

function press(k: string) {
  if (k === 'ENTER') emit('submit')
  else if (k === 'BACK') emit('backspace')
  else emit('type', k)
}
</script>

<template>
  <div class="kb" role="group" aria-label="Teclado">
    <div v-for="(row, r) in ROWS" :key="r" class="kb__row">
      <button
        v-for="k in row"
        :key="k"
        type="button"
        class="kb__key"
        :class="[keys[k] ? `is-${keys[k]}` : '', { 'is-wide': k === 'ENTER' || k === 'BACK' }]"
        :aria-label="aria(k)"
        :disabled="disabled"
        @click="press(k)"
      >
        {{ label(k) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.kb {
  display: grid;
  gap: 6px;
  padding: 0.5rem max(0.5rem, env(safe-area-inset-left)) calc(0.75rem + env(safe-area-inset-bottom));
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
}

.kb__row {
  display: flex;
  gap: 5px;
  justify-content: center;
}

.kb__key {
  flex: 1 1 0;
  min-width: 0;
  height: 3.25rem;
  border: 0;
  border-radius: 5px;
  background: var(--ord-key);
  color: var(--ord-ink);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: background 150ms ease, color 150ms ease;
}

.kb__key.is-wide {
  flex: 1.5 1 0;
  font-size: 1rem;
}

.kb__key:active { transform: translateY(1px); }
.kb__key:disabled { opacity: 0.6; cursor: default; }

.kb__key.is-correct { background: var(--ord-correct); color: #fff; }
.kb__key.is-present { background: var(--ord-present); color: #fff; }
.kb__key.is-absent { background: var(--ord-absent); color: #fff; }

@media (max-height: 640px) {
  .kb__key { height: 2.75rem; }
}
</style>
