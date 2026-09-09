<script setup lang="ts">
import type { Mode } from '../../utils/ordle-shared'
import type { Prefs, Stats } from '../../composables/useOrdleStorage'

const props = defineProps<{ stats: Stats; prefs: Prefs; mode: Mode }>()
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

    <h3 class="sub">Preferências</h3>

    <!--
      O modo difícil é outro jogo, não um ajuste do mesmo: outra palavra, outro
      tabuleiro e outra estatística. Por isso o rótulo diz o que muda, e a
      sequência mostrada acima acompanha o modo em que a pessoa está.
    -->
    <label class="row">
      <span>
        Modo difícil
        <small>Palavras de 6 a 8 letras, em 7 tentativas. Sequência própria</small>
      </span>
      <input
        type="checkbox"
        :checked="mode === 'hard'"
        @change="emit('mode', ($event.target as HTMLInputElement).checked ? 'hard' : 'normal')"
      />
    </label>

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

.credit { margin: 1.25rem 0 0; font-size: 0.8125rem; color: var(--ord-muted); text-align: center; }
.credit a { color: var(--ord-accent); }
</style>
