<script setup lang="ts">
import {
  canShareNatively,
  detectPlatform,
  shareText,
  type GameStatus,
  type Mark,
  type Mode,
} from '../../utils/ordle-shared'
import type { Stats } from '../../composables/useOrdleStorage'

const COLOR_PT: Record<string, string> = {
  green: 'verde',
  purple: 'roxo',
  red: 'vermelho',
  white: 'branco',
  rose: 'rosa',
}

const props = defineProps<{
  gameNumber: number
  mode: Mode
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
  /** o outro jogo de hoje já foi encerrado? */
  otherDone: boolean
}>()

/**
 * A oferta, composta como verbete e não como frase: sob a rubrica "hoje no
 * Ordo", "Salmo 130" diz mais — e mais rápido — que "o Ofício de hoje traz o
 * Salmo 130". Sem o salmo sobra o nome do produto, que ainda é honesto.
 */
const hookEntry = computed(() => props.psalm ?? 'Ofício Diário')

/** os dados do dia, em lista separada por ponto medial, como legenda de missal */
const hookDay = computed(() =>
  [props.celebration, props.season, COLOR_PT[props.color] ?? props.color]
    .filter(Boolean)
    .join(' · '),
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

const emit = defineEmits<{ (e: 'close'): void; (e: 'switch'): void }>()

/**
 * A porta para o outro jogo do dia. Ela existe sempre, e não só quando o outro
 * está por jogar: com a partida encerrada o botão ▤ do header abre o resultado
 * e não as configurações, então sem esta linha quem já jogou os dois não teria
 * como voltar ao outro tabuleiro até o dia virar.
 */
const otherLabel = computed(() => {
  const outro = props.mode === 'normal' ? 'o difícil' : 'o normal'
  return props.otherDone ? `Ver ${outro} de hoje` : `Jogar ${outro} de hoje`
})

/**
 * O que aconteceu de fato, e não só se aconteceu: no Windows o botão copia, e
 * dizer "Compartilhado" ali prometeria um envio que não houve — a pessoa fica
 * esperando uma janela que nunca vem, em vez de ir colar o texto.
 */
const outcome = ref<'idle' | 'shared' | 'copied'>('idle')

const shareLabel = computed(() =>
  outcome.value === 'shared' ? 'Compartilhado' : outcome.value === 'copied' ? 'Copiado' : 'Compartilhar',
)

/** só para o que dá errado; o sucesso já está escrito no botão */
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

/**
 * Cópia manual para quando `navigator.clipboard` não existe ou é negado —
 * contexto inseguro (http://…), navegador antigo, permissão bloqueada.
 */
function copyFallback(text: string) {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(el)
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    if (!copyFallback(text)) throw new Error('clipboard indisponível')
  }
}

/**
 * Share sheet nativo onde ele funciona; no Windows, copiar.
 *
 * Mac, iOS e Android abrem uma folha que resolve rápido. O Windows não: lá o
 * `navigator.share` existe (Chrome e Edge) mas delega para a folha do sistema,
 * que trava no spinner com frequência — e como a promessa não rejeita enquanto
 * isso, o usuário fica preso numa caixa que não é nossa e o copiar nunca roda.
 * Copiar direto é o gesto que ele ia fazer de qualquer jeito.
 */
async function share() {
  const text = shareText({
    gameNumber: props.gameNumber,
    results: props.results,
    status: props.status,
    mode: props.mode,
    dark: props.dark,
    url: import.meta.client ? location.origin : undefined,
  })

  const native = import.meta.client && canShareNatively(navigator.userAgent, !!navigator.share)

  try {
    if (native) {
      await navigator.share({ text })
      outcome.value = 'shared'
    } else {
      await copy(text)
      outcome.value = 'copied'
    }
  } catch (err) {
    /* usuário cancelou o share sheet — não é erro */
    if ((err as Error)?.name === 'AbortError') return
    /* share nativo falhou por outro motivo: ainda dá para copiar */
    if (native) {
      try {
        await copy(text)
        outcome.value = 'copied'
      } catch {
        toast.value = 'Não foi possível copiar'
        setTimeout(() => (toast.value = ''), 1600)
      }
    }
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

      Sem banner e sem caixa de aviso — interstício converte pior num jogo
      diário, e caixa arredondada com barra colorida é o componente que todo
      gerador de layout cospe. Aqui o bloco é composto como entrada de missal:
      filete, rubrica em versalete na cor do dia, verbete em serifa e uma
      linha de índice para abrir.

      A especificidade é o que faz a propaganda funcionar: "Salmo 130" prova
      que o app tem conteúdo, coisa que "baixe nosso aplicativo" não faz.
    -->
    <aside class="hook">
      <p class="hook__label">Hoje no Ordo</p>
      <p class="hook__entry">{{ hookEntry }}</p>
      <p class="hook__day">{{ hookDay }}</p>
      <a class="hook__go" :href="ordoUrl" target="_blank" rel="noopener">
        <span>{{ ordoLabel }}</span>
        <span class="hook__go-arrow" aria-hidden="true">→</span>
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

    <!--
      5: o outro jogo do dia.

      Fica aqui, e não no header, porque este é o momento em que a pergunta faz
      sentido: acabou um, ainda dá para jogar o outro. É linha de navegação, não
      propaganda — por isso vem depois do gancho do Ordo e sem caixa.
    -->
    <button type="button" class="other" @click="emit('switch')">
      {{ otherLabel }}
      <span aria-hidden="true">→</span>
    </button>

    <!-- 6 e 7: quanto falta e compartilhar -->
    <div class="footer">
      <div class="next">
        <span class="next__label">Próxima palavra</span>
        <span class="next__clock">{{ remaining }}</span>
      </div>
      <!--
        `aria-live` no próprio botão: quem usa leitor de tela está com o foco
        nele, e a troca do rótulo é o único sinal de que copiou.
      -->
      <button type="button" class="share" aria-live="polite" @click="share">
        {{ shareLabel }}
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

/*
 * Sem caixa arredondada e sem botão de fundo tingido: esse par é o que faz a
 * seção parecer template genérico. O bloco vira uma entrada tipográfica —
 * filete em cima, rubrica em versalete na cor do dia (como rubrica impressa),
 * verbete em serifa e uma linha de índice para abrir.
 */
.hook {
  margin: 0 0 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--ord-rule);
}

.hook__label {
  margin: 0 0 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ord-accent);
}

.hook__entry {
  margin: 0;
  font-family: var(--ord-display);
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.15;
}

.hook__day {
  margin: 0.1875rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--ord-muted);
}

/*
 * Linha de índice: hairline em cima, rótulo à esquerda, seta à direita. Lê
 * como sumário de livro impresso e continua sendo alvo de 44px — um link de
 * texto solto seria discreto demais para a única ação que leva ao app.
 */
.hook__go {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.875rem;
  padding: 0.75rem 0;
  min-height: 2.75rem;
  border-top: 1px solid var(--ord-rule);
  font-size: 0.9375rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--ord-ink);
}

.hook__go-arrow { color: var(--ord-accent); }

.hook__go:active { color: var(--ord-accent); }

@media (hover: hover) {
  .hook__go:hover { color: var(--ord-accent); }
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

.other {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  width: 100%;
  min-height: 2.75rem;
  margin: 0 0 0.25rem;
  padding: 0.5rem;
  font: inherit;
  font-size: 0.875rem;
  background: none;
  border: 0;
  border-top: 1px solid var(--ord-rule);
  color: var(--ord-accent);
  cursor: pointer;
}

.copied { text-align: center; margin: 0.75rem 0 0; font-size: 0.8125rem; color: var(--ord-muted); }
</style>
