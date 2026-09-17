<script setup lang="ts">
import type { Mode } from '../utils/ordle-shared'

type Entry = {
  rank: number
  firstName: string
  points: number
  wins: number
  played: number
  averageAttempts: number
}

const mode = ref<Mode>('normal')
const entries = ref<Entry[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ entries: Entry[] }>('/api/ranking', { query: { mode: mode.value } })
    entries.value = response.entries
  } catch {
    error.value = 'Não foi possível carregar o ranking.'
  } finally {
    loading.value = false
  }
}

watch(mode, () => void load())
onMounted(() => void load())
</script>

<template>
  <main class="ranking-page">
    <header class="ranking-page__head">
      <NuxtLink class="back" to="/">← Ordle</NuxtLink>
      <h1>Ranking</h1>
      <p>Os melhores resultados dos últimos 30 dias.</p>
    </header>

    <nav class="modes" aria-label="Modo do ranking">
      <button type="button" :aria-pressed="mode === 'normal'" @click="mode = 'normal'">Normal</button>
      <button type="button" :aria-pressed="mode === 'hard'" @click="mode = 'hard'">Difícil</button>
    </nav>

    <p v-if="loading" class="message">Carregando…</p>
    <p v-else-if="error" class="message" role="alert">{{ error }}</p>
    <p v-else-if="!entries.length" class="message">Ainda não há resultados públicos.</p>
    <ol v-else class="entries">
      <li v-for="entry in entries" :key="`${entry.rank}-${entry.firstName}`" class="entry">
        <span class="entry__rank">{{ entry.rank }}</span>
        <span class="entry__name">{{ entry.firstName }}</span>
        <span class="entry__stats">
          {{ entry.points }} pts · {{ entry.wins }} vitórias · {{ entry.played }} jogos
        </span>
      </li>
    </ol>
  </main>
</template>

<style scoped>
.ranking-page {
  width: min(32rem, calc(100% - 2rem));
  min-height: 100dvh;
  margin: 0 auto;
  padding: 2rem 0;
  color: var(--ord-ink);
}
.ranking-page__head { border-bottom: 1px solid var(--ord-rule); padding-bottom: 1rem; }
.back { color: var(--ord-accent); text-decoration: none; font-size: 0.875rem; }
h1 { margin: 2rem 0 0.25rem; font-family: var(--ord-display); font-size: 2.5rem; font-weight: 600; }
.ranking-page p { margin: 0; color: var(--ord-muted); font-size: 0.875rem; }
.modes { display: flex; gap: 0.25rem; margin: 1.25rem 0; }
.modes button { border: 0; border-bottom: 2px solid transparent; background: none; padding: 0.5rem 0.75rem; color: var(--ord-muted); font: inherit; cursor: pointer; }
.modes button[aria-pressed='true'] { color: var(--ord-ink); border-bottom-color: var(--ord-accent); font-weight: 600; }
.entries { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.entry { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding: 0.75rem 0; border-bottom: 1px solid var(--ord-rule); }
.entry__rank { color: var(--ord-muted); font-variant-numeric: tabular-nums; text-align: right; }
.entry__name { font-weight: 600; }
.entry__stats { color: var(--ord-muted); font-size: 0.75rem; text-align: right; white-space: nowrap; }
.message { margin-top: 2rem !important; text-align: center; }
@media (max-width: 480px) { .entry { grid-template-columns: 1.5rem minmax(0, 1fr); } .entry__stats { grid-column: 2; text-align: left; } }
</style>
