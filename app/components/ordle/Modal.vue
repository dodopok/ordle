<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const panel = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKey, true)
  nextTick(() => panel.value?.focus())
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div
      ref="panel"
      class="modal__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <header class="modal__head">
        <h2 class="modal__title">{{ title }}</h2>
        <button type="button" class="modal__close" aria-label="Fechar" @click="emit('close')">
          ×
        </button>
      </header>
      <div class="modal__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--ord-ink) 45%, transparent);
  animation: fade 160ms ease;
}

.modal__panel {
  width: min(28rem, 100%);
  max-height: 88vh;
  overflow-y: auto;
  background: var(--ord-surface);
  border: 1px solid var(--ord-rule);
  border-top: 3px solid var(--ord-accent);
  border-radius: 10px;
  padding: 1.25rem;
  animation: rise 200ms ease;
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.modal__title {
  margin: 0;
  font-family: var(--ord-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.modal__close {
  border: 0;
  background: none;
  font-size: 1.5rem;
  line-height: 1;
  padding: 0 0.25rem;
  color: var(--ord-muted);
}

@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
</style>
