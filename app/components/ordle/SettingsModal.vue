<script setup lang="ts">
import type { Mode } from '../../utils/ordle-shared'
import type { Prefs, Stats } from '../../composables/useOrdleStorage'

const props = defineProps<{
  stats: Stats
  prefs: Prefs
  mode: Mode
  /** quais dos dois jogos de hoje já foram encerrados */
  done: Record<Mode, boolean>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update', prefs: Prefs): void
  (e: 'mode', mode: Mode): void
}>()

const winRate = computed(() =>
  props.stats.played ? Math.round((props.stats.wins / props.stats.played) * 100) : 0,
)

const set = (patch: Partial<Prefs>) => emit('update', { ...props.prefs, ...patch })
</script>

<template>
  <OrdleModal :title="mode === 'hard' ? 'Estatísticas (difícil)' : 'Estatísticas'" @close="emit('close')">
    <div class="stats">
      <div><b>{{ stats.played }}</b><span>jogos</span></div>
      <div><b>{{ winRate }}%</b><span>vitórias</span></div>
      <div><b>{{ stats.streak }}</b><span>sequência</span></div>
      <div><b>{{ stats.maxStreak }}</b><span>recorde</span></div>
    </div>

    <!--
      Dois jogos por dia, não um interruptor de preferência: dá para jogar os
      dois, em qualquer ordem, e cada um guarda a própria partida e a própria
      sequência. Por isso são dois botões lado a lado e não uma caixinha de
      "modo difícil" — caixinha se lê como "ou um, ou outro".

      O ✓ diz qual já foi encerrado hoje, que é a pergunta de quem volta ao
      jogo à noite sem lembrar se jogou o segundo.
    -->
    <div class="row">
      <span>
        Jogo de hoje
        <small>Difícil: 6 a 8 letras, 7 tentativas, sequência própria</small>
      </span>
      <div class="seg" role="group" aria-label="Escolher o jogo de hoje">
        <button
          type="button"
          :class="{ 'is-on': mode === 'normal' }"
          :aria-pressed="mode === 'normal'"
          @click="emit('mode', 'normal')"
        >
          Normal<span v-if="done.normal" aria-label="já jogado"> ✓</span>
        </button>
        <button
          type="button"
          :class="{ 'is-on': mode === 'hard' }"
          :aria-pressed="mode === 'hard'"
          @click="emit('mode', 'hard')"
        >
          Difícil<span v-if="done.hard" aria-label="já jogado"> ✓</span>
        </button>
      </div>
    </div>

    <h3 class="sub">Preferências</h3>

    <label class="row">
      <span>Tema</span>
      <select :value="prefs.theme" @change="set({ theme: ($event.target as HTMLSelectElement).value as Prefs['theme'] })">
        <option value="system">Sistema</option>
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
      </select>
    </label>

    <label class="row">
      <span>
        Alto contraste
        <small>Troca verde/ouro por azul/laranja</small>
      </span>
      <input
        type="checkbox"
        :checked="prefs.highContrast"
        @change="set({ highContrast: ($event.target as HTMLInputElement).checked })"
      />
    </label>

    <p class="credit">
      Ordle é um projeto do <a href="https://oficio.app" target="_blank" rel="noopener">Ordo</a>.
    </p>
  </OrdleModal>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  text-align: center;
  margin-bottom: 1.5rem;
}
.stats b { display: block; font-size: 1.375rem; font-family: var(--ord-display); }
.stats span { font-size: 0.6875rem; color: var(--ord-muted); text-transform: uppercase; letter-spacing: 0.06em; }

.sub {
  margin: 0 0 0.5rem;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ord-muted);
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--ord-rule);
  font-size: 0.875rem;
}

.row small { display: block; color: var(--ord-muted); font-size: 0.75rem; }
.row select { font: inherit; padding: 0.25rem; background: var(--ord-bg); color: inherit; border: 1px solid var(--ord-rule); border-radius: 4px; }
.row input[type='checkbox'] { width: 1.125rem; height: 1.125rem; accent-color: var(--ord-accent); }

.seg { display: flex; border: 1px solid var(--ord-rule); border-radius: 4px; overflow: hidden; flex: none; }
.seg button {
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.375rem 0.625rem;
  min-height: 2.25rem; /* alvo de toque */
  background: var(--ord-bg);
  color: var(--ord-muted);
  border: 0;
  cursor: pointer;
}
.seg button + button { border-left: 1px solid var(--ord-rule); }
.seg button.is-on { background: var(--ord-accent); color: #fff; font-weight: 600; }

.credit { margin: 1.25rem 0 0; font-size: 0.8125rem; color: var(--ord-muted); text-align: center; }
.credit a { color: var(--ord-accent); }
</style>
