<script setup lang="ts">
import { useOrdle } from '../composables/useOrdle'
import { useOrdleStorage, type Prefs } from '../composables/useOrdleStorage'

// é um jogo: SEO não importa aqui, e localStorage não existe no SSR
definePageMeta({ ssr: false })

const TITULO = 'Ordle — o Wordle litúrgico'
const RESUMO =
  'Uma palavra litúrgica de 5 letras por dia, em 6 tentativas. No fim, a definição do termo — e o Ofício de hoje.'

useHead({
  title: TITULO,
  meta: [
    { name: 'description', content: RESUMO },
    /*
     * Open Graph: o link é o produto, e a maior parte do tráfego vem de link
     * colado no WhatsApp. O crawler de preview não executa JavaScript, então
     * estas tags precisam estar no HTML que o servidor entrega — e estão,
     * mesmo com a página em `ssr: false`, porque o Nuxt monta o head no shell.
     */
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Ordle' },
    { property: 'og:title', content: TITULO },
    { property: 'og:description', content: RESUMO },
    { property: 'og:locale', content: 'pt_BR' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: TITULO },
    { name: 'twitter:description', content: RESUMO },
    // a barra do navegador acompanha o tema — sem isso, no escuro fica uma
    // faixa clara em cima da tela
    { name: 'theme-color', content: '#FBF9F4', media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: '#14130F', media: '(prefers-color-scheme: dark)' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    { name: 'apple-mobile-web-app-title', content: 'Ordle' },
  ],
})

const { state, keys, type, backspace, submit, focusCell } = useOrdle()
const storage = useOrdleStorage()

// --- preferências --------------------------------------------------------
const prefs = ref<Prefs>({ v: 1, theme: 'system', highContrast: false, sound: true })
const systemDark = ref(false)

onMounted(() => {
  prefs.value = storage.loadPrefs()
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mq.matches
  mq.addEventListener('change', (e) => (systemDark.value = e.matches))
})

const dark = computed(() =>
  prefs.value.theme === 'system' ? systemDark.value : prefs.value.theme === 'dark',
)

function updatePrefs(p: Prefs) {
  prefs.value = p
  storage.savePrefs(p)
}

// --- header --------------------------------------------------------------
// "17 ago" — o toLocaleDateString pt-BR devolve "17 de ago.", longo demais
// para o header e com um ponto que briga com o separador "·"
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const today = computed(() => {
  if (!state.gameId) return ''
  const [, m, d] = state.gameId.split('-').map(Number)
  return `${d} ${MESES[m - 1]}`
})

const stats = computed(() => state.stats ?? storage.loadStats())

function openResult() {
  state.modal = state.status === 'playing' ? 'settings' : 'result'
}
</script>

<template>
  <div
    class="ordle"
    :data-color="state.liturgicalColor"
    :data-theme="dark ? 'dark' : 'light'"
    :data-contrast="prefs.highContrast ? 'high' : null"
  >
    <header class="hd">
      <div class="hd__rule" aria-hidden="true" />
      <div class="hd__bar">
        <h1 class="hd__logo">Ordle</h1>
        <p class="hd__meta">
          <span class="hd__n">#{{ state.gameNumber }}</span>
          <span aria-hidden="true"> · </span>
          <span>{{ today }}</span>
        </p>
        <div class="hd__actions">
          <button type="button" aria-label="Como jogar" @click="state.modal = 'help'">?</button>
          <button type="button" aria-label="Estatísticas" @click="openResult">▤</button>
        </div>
      </div>
    </header>

    <main class="main">
      <OrdleBoard
        :guesses="state.guesses"
        :results="state.results"
        :current="state.current"
        :cursor="state.cursor"
        :status="state.status"
        :shake="state.shake"
        :reveal="state.reveal"
        :win="state.win"
        @select="focusCell"
      />
    </main>

    <OrdleKeyboard
      :keys="keys"
      :disabled="state.status !== 'playing' || state.busy"
      @type="type"
      @backspace="backspace"
      @submit="submit"
    />

    <Transition name="toast">
      <p v-if="state.toast" class="toast" role="status">{{ state.toast }}</p>
    </Transition>

    <div v-if="state.rollover" class="rollover" role="status">
      <span>Nova palavra disponível</span>
      <button type="button" @click="() => reloadNuxtApp()">Recarregar</button>
    </div>

    <OrdleHelpModal v-if="state.modal === 'help'" @close="state.modal = null" />

    <OrdleSettingsModal
      v-else-if="state.modal === 'settings'"
      :stats="stats"
      :prefs="prefs"
      @update="updatePrefs"
      @close="state.modal = null"
    />

    <OrdleResultModal
      v-else-if="state.modal === 'result'"
      :game-number="state.gameNumber"
      :status="state.status"
      :answer="state.answer"
      :definition="state.definition"
      :results="state.results"
      :stats="stats"
      :next-rollover-at="state.nextRolloverAt"
      :season="state.liturgicalSeason"
      :celebration="state.liturgicalCelebration"
      :color="state.liturgicalColor"
      :psalm="state.liturgicalPsalm"
      :dark="dark"
      @close="state.modal = null"
    />
  </div>
</template>

<style scoped>
.ordle {
  min-height: 100vh; /* fallback: iOS antigo não conhece dvh */
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--ord-bg);
  color: var(--ord-ink);
}

.hd { border-bottom: 1px solid var(--ord-rule); }

/* o filete na cor litúrgica do dia — o único lugar onde ela aparece forte */
.hd__rule { height: 3px; background: var(--ord-accent); }

.hd__bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  /* o notch entra pela lateral quando o aparelho está deitado */
  padding: 0.625rem max(0.875rem, env(safe-area-inset-right)) 0.625rem
    max(0.875rem, env(safe-area-inset-left));
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
}

.hd__logo {
  margin: 0;
  font-family: var(--ord-display);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 1;
}

.hd__meta {
  flex: 1;
  margin: 0;
  font-size: 0.75rem;
  color: var(--ord-muted);
  letter-spacing: 0.04em;
}

.hd__n { color: var(--ord-accent); font-weight: 600; }

.hd__actions { display: flex; gap: 0.25rem; }

.hd__actions button {
  border: 0;
  background: none;
  font-size: 1.125rem;
  line-height: 1;
  /* 44px é o alvo de toque mínimo — antes eram ~30px, difíceis de acertar
     com o polegar sem abrir o modal errado */
  min-width: 2.75rem;
  min-height: 2.75rem;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 4px;
  color: var(--ord-muted);
}

/* no touch não existe hover: o feedback tem que vir do :active */
.hd__actions button:active { color: var(--ord-ink); background: var(--ord-key); }

@media (hover: hover) {
  .hd__actions button:hover { color: var(--ord-ink); }
}

.main { display: grid; align-content: center; min-height: 0; }

/* celular deitado: tabuleiro à esquerda, teclado à direita */
@media (orientation: landscape) and (max-height: 560px) {
  .ordle {
    grid-template-columns: 1fr minmax(0, 26rem);
    grid-template-rows: auto 1fr;
  }

  .hd { grid-column: 1 / -1; }

  .main { padding-left: env(safe-area-inset-left); }

  .ordle :deep(.kb) {
    align-self: center;
    padding-right: max(0.5rem, env(safe-area-inset-right));
  }

  .toast { top: 3.5rem; }
}

.toast {
  position: fixed;
  top: 4.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  margin: 0;
  background: var(--ord-ink);
  color: var(--ord-bg);
  padding: 0.625rem 1rem;
  border-radius: 5px;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
}

.toast-enter-active, .toast-leave-active { transition: opacity 180ms ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; }

.rollover {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--ord-surface);
  border: 1px solid var(--ord-rule);
  border-left: 3px solid var(--ord-accent);
  border-radius: 6px;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
}

.rollover button {
  border: 0;
  background: var(--ord-accent);
  color: #fff;
  border-radius: 4px;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
}
</style>
