<script setup lang="ts">
import { MAX_ATTEMPTS, shareText, type GameStatus, type Mark } from '../../utils/ordle-shared'
import type { Stats } from '../../composables/useOrdleStorage'

const props = defineProps<{
  gameNumber: number
  status: GameStatus
  answer: string | null
  definition: string | null
  results: Mark[][]
  stats: Stats | null
  nextRolloverAt: number
  season: string
  celebration: string
  color: string
  dark: boolean
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const COLOR_PT: Record<string, string> = {
  green: 'verde',
  purple: 'roxo',
  red: 'vermelho',
  white: 'branco',
  rose: 'rosa',
}

const shared = ref(false)
const toast = ref('')

const winRate = computed(() =>
  props.stats && props.stats.played ? Math.round((props.stats.wins / props.stats.played) * 100) : 0,
)

const maxBar = computed(() => Math.max(1, ...(props.stats?.distribution ?? [1])))
const winningRow = computed(() => (props.status === 'won' ? props.results.length : 0))

// --- contagem regressiva -------------------------------------------------
const remaining = ref('')
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  const ms = props.nextRolloverAt - Date.now()
  if (ms <= 0) return (remaining.value = '00:00:00')
  const s = Math.floor(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  remaining.value = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

// --- compartilhar --------------------------------------------------------
async function share() {
  const text = shareText({
    gameNumber: props.gameNumber,
    results: props.results,
    status: props.status,
    dark: props.dark,
    url: import.meta.client ? `${location.origin}/ordle` : undefined,
  })
  try {
    if (import.meta.client && navigator.share) {
      await navigator.share({ text })
    } else {
      await navigator.clipboard.writeText(text)
      toast.value = 'Copiado'
      setTimeout(() => (toast.value = ''), 1600)
    }
    shared.value = true
  } catch {
    /* usuário cancelou o share sheet — não é erro */
  }
}
</script>

<template>
  <OrdleModal :title="status === 'won' ? 'Acertou' : 'Fim de jogo'" @close="emit('close')">
    <!-- 1 e 2: a palavra e o que ela quer dizer -->
    <p class="reveal">{{ answer }}</p>
    <p class="definition">{{ definition }}</p>

    <!-- 3: o gancho para o Ordo, uma linha só -->
    <div class="hook">
      <p>
        Hoje é <strong>{{ celebration }}</strong> — {{ season }}, cor litúrgica
        <span class="swatch" aria-hidden="true" /> {{ COLOR_PT[color] ?? color }}. O Ofício de hoje
        está no Ordo.
      </p>
      <a class="hook__btn" href="https://oficio.app" target="_blank" rel="noopener">
        Abrir o Ofício de hoje
      </a>
    </div>

    <!-- 4: estatísticas -->
    <template v-if="stats">
      <div class="stats">
        <div><b>{{ stats.played }}</b><span>jogos</span></div>
        <div><b>{{ winRate }}%</b><span>vitórias</span></div>
        <div><b>{{ stats.streak }}</b><span>sequência</span></div>
        <div><b>{{ stats.maxStreak }}</b><span>recorde</span></div>
      </div>

      <h3 class="sub">Distribuição</h3>
      <div class="dist">
        <div v-for="(n, i) in stats.distribution" :key="i" class="dist__row">
          <span class="dist__n">{{ i + 1 }}</span>
          <span
            class="dist__bar"
            :class="{ 'is-current': i + 1 === winningRow }"
            :style="{ width: `${Math.max(8, (n / maxBar) * 100)}%` }"
          >
            {{ n }}
          </span>
        </div>
      </div>
    </template>

    <!-- 5 e 6: quanto falta e compartilhar -->
    <div class="footer">
      <div class="next">
        <span class="next__label">Próxima palavra</span>
        <span class="next__clock">{{ remaining }}</span>
      </div>
      <button type="button" class="share" @click="share">
        {{ shared ? 'Compartilhado' : 'Compartilhar' }}
      </button>
    </div>
    <p v-if="toast" class="copied" role="status">{{ toast }}</p>
  </OrdleModal>
</template>

<style scoped>
.reveal {
  margin: 0;
  font-family: var(--ord-display);
  font-size: 2.5rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: center;
}

.definition {
  margin: 0.25rem 0 1.25rem;
  text-align: center;
  color: var(--ord-muted);
  font-size: 0.9375rem;
}

.hook {
  border: 1px solid var(--ord-rule);
  border-left: 3px solid var(--ord-accent);
  border-radius: 6px;
  padding: 0.75rem 0.875rem;
  margin-bottom: 1.25rem;
}

.hook p { margin: 0 0 0.625rem; font-size: 0.875rem; line-height: 1.5; }

.swatch {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: var(--ord-accent);
  border: 1px solid var(--ord-rule);
  vertical-align: baseline;
}

.hook__btn {
  display: inline-block;
  font-size: 0.8125rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--ord-accent);
}

.hook__btn::after { content: ' →'; }

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  text-align: center;
  margin-bottom: 1.25rem;
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

.dist { display: grid; gap: 4px; margin-bottom: 1.25rem; }
.dist__row { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; }
.dist__n { width: 0.75rem; color: var(--ord-muted); }

.dist__bar {
  background: var(--ord-absent);
  color: #fff;
  padding: 2px 6px;
  text-align: right;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}

.dist__bar.is-current { background: var(--ord-correct); }

.footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  border-top: 1px solid var(--ord-rule);
  padding-top: 1rem;
}

.next { flex: 1; }
.next__label { display: block; font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ord-muted); }
.next__clock { font-family: var(--ord-display); font-size: 1.5rem; font-variant-numeric: tabular-nums; }

.share {
  border: 0;
  border-radius: 6px;
  background: var(--ord-correct);
  color: #fff;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.75rem 1.25rem;
}

.copied { text-align: center; margin: 0.75rem 0 0; font-size: 0.8125rem; color: var(--ord-muted); }
</style>
