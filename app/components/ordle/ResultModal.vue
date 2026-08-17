<script setup lang="ts">
import {
  MAX_ATTEMPTS,
  detectPlatform,
  shareText,
  type GameStatus,
  type Mark,
} from '../../utils/ordle-shared'
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
  psalm: string | null
  dark: boolean
}>()

/**
 * A oferta. Com o salmo do dia ela é concreta e verificável; sem ele sobra a
 * versão genérica, que converte pior mas nunca some.
 */
const hookLine = computed(() =>
  props.psalm ? `O Ofício de hoje traz o ${props.psalm}.` : 'O Ofício de hoje já está no Ordo.',
)

/**
 * Plataforma resolvida já no setup, não no onMounted: a página é `ssr: false`,
 * então `navigator` existe aqui. Detectar depois faria o botão piscar com o
 * rótulo de desktop antes de virar o da loja.
 */
const platform = import.meta.client
  ? detectPlatform(navigator.userAgent, navigator.maxTouchPoints)
  : 'desktop'

const APP_STORE_ID = '6756016908'
const PLAY_PACKAGE = 'br.com.caminhoanglicano.ordo'

const campaign = computed(() => (props.status === 'won' ? 'vitoria' : 'derrota'))

/**
 * Celular vai direto para a loja da plataforma; desktop vai para a landing do
 * Ofício, onde não há app para instalar.
 *
 * Cada destino leva o parâmetro de campanha que ele entende: loja ignora UTM
 * solto, então o Google Play recebe `referrer` e a App Store recebe `ct`. Sem
 * isso não dá para saber se o jogo instala alguém.
 */
const ordoUrl = computed(() => {
  if (platform === 'android') {
    const u = new URL('https://play.google.com/store/apps/details')
    u.searchParams.set('id', PLAY_PACKAGE)
    u.searchParams.set(
      'referrer',
      `utm_source=ordle&utm_medium=jogo&utm_campaign=resultado&utm_content=${campaign.value}`,
    )
    return u.toString()
  }

  if (platform === 'ios') {
    const u = new URL(`https://apps.apple.com/br/app/id${APP_STORE_ID}`)
    u.searchParams.set('ct', `ordle-${campaign.value}`)
    u.searchParams.set('mt', '8')
    return u.toString()
  }

  const u = new URL('https://www.oficio.app/oficio-diario')
  u.searchParams.set('utm_source', 'ordle')
  u.searchParams.set('utm_medium', 'jogo')
  u.searchParams.set('utm_campaign', 'resultado')
  u.searchParams.set('utm_content', campaign.value)
  return u.toString()
})

/** o rótulo diz para onde o link leva de verdade — isca converte pior */
const ordoLabel = computed(() =>
  platform === 'android'
    ? 'Baixar o Ordo no Google Play'
    : platform === 'ios'
      ? 'Baixar o Ordo na App Store'
      : 'Abrir o Ofício de hoje',
)

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
    url: import.meta.client ? location.origin : undefined,
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

    <!--
      3: o gancho para o Ordo.

      Continua sendo uma linha, sem banner — interstício converte pior num jogo
      diário. O que melhora a conversão aqui é a especificidade: dizer o que o
      Ofício traz HOJE prova que o app tem conteúdo, coisa que "baixe nosso
      aplicativo" não faz. Por isso o salmo do dia entra quando a API o traz.
    -->
    <aside class="hook">
      <p class="hook__day">
        <span class="swatch" aria-hidden="true" />
        Hoje é <strong>{{ celebration }}</strong> — {{ season }}, cor
        {{ COLOR_PT[color] ?? color }}.
      </p>
      <p class="hook__line">{{ hookLine }}</p>
      <a class="hook__btn" :href="ordoUrl" target="_blank" rel="noopener">
        {{ ordoLabel }}
      </a>
    </aside>

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

/* a linha do dia é contexto: menor e discreta */
.hook__day {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--ord-muted);
  letter-spacing: 0.01em;
}

.hook__day strong { color: var(--ord-ink); font-weight: 600; }

/* a linha do salmo é a oferta: é ela que tem que ser lida */
.hook__line {
  margin: 0 0 0.75rem;
  font-family: var(--ord-display);
  font-size: 1.0625rem;
  line-height: 1.35;
}

.swatch {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--ord-accent);
  border: 1px solid var(--ord-rule);
  margin-right: 0.25rem;
}

/*
 * Botão de verdade, não link de texto: é a única ação da tela além de
 * compartilhar, e um alvo de 44px acerta com o polegar. Continua sendo uma
 * linha dentro do bloco — não vira banner.
 */
.hook__btn {
  display: block;
  min-height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border: 1px solid var(--ord-accent);
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--ord-accent);
  background: color-mix(in srgb, var(--ord-accent) 8%, transparent);
}

.hook__btn::after { content: '→'; }

.hook__btn:active { background: color-mix(in srgb, var(--ord-accent) 18%, transparent); }

@media (hover: hover) {
  .hook__btn:hover { background: color-mix(in srgb, var(--ord-accent) 16%, transparent); }
}

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
