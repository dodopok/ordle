<script setup lang="ts">
import type { Mode } from '../../utils/ordle-shared'
import type { Prefs, Stats } from '../../composables/useOrdleStorage'
import type { AuthView } from '../../composables/useOrdleAuth'

const props = defineProps<{ stats: Stats; prefs: Prefs; mode: Mode; auth: AuthView }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update', prefs: Prefs): void
  (e: 'login'): void
  (e: 'logout'): void
  (e: 'profile', patch: { publicFirstName?: string; leaderboardOptIn?: boolean }): void
}>()

const winRate = computed(() =>
  props.stats.played ? Math.round((props.stats.wins / props.stats.played) * 100) : 0,
)

const set = (patch: Partial<Prefs>) => emit('update', { ...props.prefs, ...patch })
const name = ref('')

watch(
  () => props.auth.firstName,
  (value) => (name.value = value),
  { immediate: true },
)

function saveName() {
  if (name.value.trim()) emit('profile', { publicFirstName: name.value })
}
</script>

<template>
  <OrdleModal :title="mode === 'hard' ? 'Estatísticas (difícil)' : 'Estatísticas'" @close="emit('close')">
    <div class="stats">
      <div><b>{{ stats.played }}</b><span>jogos</span></div>
      <div><b>{{ winRate }}%</b><span>vitórias</span></div>
      <div><b>{{ stats.streak }}</b><span>sequência</span></div>
      <div><b>{{ stats.maxStreak }}</b><span>recorde</span></div>
    </div>

    <h3 class="sub">Conta</h3>
    <div class="account">
      <template v-if="!auth.ready">
        <p class="account__hint">Verificando a conta…</p>
      </template>
      <template v-else-if="!auth.signedIn">
        <p class="account__hint">Entre para guardar seu progresso em outros dispositivos.</p>
        <button class="google" type="button" :disabled="!auth.enabled" @click="emit('login')">
          Entrar com Google
        </button>
      </template>
      <template v-else-if="!auth.profileReady">
        <p class="account__hint">Carregando os dados da conta…</p>
      </template>
      <template v-else>
        <p class="account__hint">
          Conectado como <b>{{ auth.firstName }}</b>.
          <span v-if="auth.syncing"> Sincronizando…</span>
        </p>
        <label class="row">
          <span>Primeiro nome no ranking</span>
          <input v-model="name" maxlength="32" type="text" @change="saveName" />
        </label>
        <label class="row">
          <span>
            Aparecer no ranking
            <small>Mostra apenas o primeiro nome</small>
          </span>
          <input
            type="checkbox"
            :checked="auth.leaderboardOptIn"
            @change="emit('profile', { leaderboardOptIn: ($event.target as HTMLInputElement).checked })"
          />
        </label>
        <button class="logout" type="button" @click="emit('logout')">Sair da conta</button>
      </template>
      <p v-if="auth.error" class="account__error" role="alert">{{ auth.error }}</p>
      <NuxtLink class="ranking" to="/ranking">Ver ranking →</NuxtLink>
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
.row input[type='text'] { width: 9rem; min-height: 2rem; padding: 0.25rem 0.5rem; font: inherit; background: var(--ord-bg); color: inherit; border: 1px solid var(--ord-rule); border-radius: 4px; }
.row input[type='checkbox'] { width: 1.125rem; height: 1.125rem; accent-color: var(--ord-accent); }

.account { margin-bottom: 1.5rem; }
.account__hint { margin: 0 0 0.75rem; color: var(--ord-muted); font-size: 0.8125rem; line-height: 1.45; }
.account__error { margin: 0.75rem 0 0; color: var(--ord-absent); font-size: 0.8125rem; }
.google, .logout { width: 100%; min-height: 2.75rem; border-radius: 5px; font: inherit; font-weight: 600; cursor: pointer; }
.google { border: 0; background: var(--ord-ink); color: var(--ord-bg); }
.google:disabled { opacity: 0.5; cursor: not-allowed; }
.logout { margin-top: 0.75rem; border: 1px solid var(--ord-rule); background: none; color: var(--ord-muted); }
.ranking { display: block; margin-top: 0.875rem; color: var(--ord-accent); font-size: 0.875rem; text-decoration: none; }

</style>
