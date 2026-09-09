import { describe, expect, it } from 'vitest'
import { WORDS } from '../server/utils/words'
import { WORDS_HARD } from '../server/utils/words-hard'
import { isValidGuess } from '../server/utils/dictionary'
import {
  MAX_ATTEMPTS,
  answerFor,
  gameId,
  gameNumber,
  grade,
  isMode,
  nextRolloverAt,
  normalize,
} from '../server/utils/ordle'
import { computeLiturgicalDay, easter, extractDay, parseColor } from '../server/utils/liturgy'
import { cookieOptions, seal, unseal } from '../server/utils/session'
import {
  detectPlatform,
  keyboardState,
  shareHeadline,
  shareText,
} from '../app/utils/ordle-shared'

const marks = (guess: string, answer: string) => grade(guess, answer).join(' ')

describe('grade', () => {
  it('marca acertos exatos', () => {
    expect(marks('SALMO', 'SALMO')).toBe('correct correct correct correct correct')
  })

  it('marca ausentes', () => {
    expect(marks('BUFFE', 'SALMO')).toBe('absent absent absent absent absent')
  })

  it('não gasta letra repetida duas vezes: SALSA vs SALMO', () => {
    // o segundo S sai cinza — o único S da resposta já foi consumido na posição 0
    expect(marks('SALSA', 'SALMO')).toBe('correct correct correct absent absent')
  })

  it('prefere o acerto exato ao presente com letra repetida', () => {
    // MISSA tem dois S; SUSTO tem dois S, um deles na posição certa
    expect(marks('SUSTO', 'MISSA')).toBe('present absent correct absent absent')
  })

  it('marca presente só até a contagem da resposta', () => {
    // PALMA tem dois A; ALALA pede três — o terceiro A sai cinza
    expect(marks('ALALA', 'PALMA')).toBe('present present absent absent correct')
  })

  it('acerto exato não devolve letra para o pool', () => {
    // CORPO tem dois O, os dois acertados na posição — sobra nada para os outros
    expect(marks('OOOOO', 'CORPO')).toBe('absent correct absent absent correct')
  })
})

describe('normalize', () => {
  it('ignora acentos e caixa', () => {
    expect(normalize('unção')).toBe('UNCAO')
    expect(normalize('  Ambão ')).toBe('AMBAO')
    expect(normalize('Êxodo')).toBe('EXODO')
    expect(normalize('órgão')).toBe('ORGAO')
  })
})

describe('lista de respostas', () => {
  it('toda key casa com /^[A-Z]{5}$/', () => {
    const bad = WORDS.filter((w) => !/^[A-Z]{5}$/.test(w.key))
    expect(bad.map((w) => w.word)).toEqual([])
  })

  it('toda key é a normalização da própria palavra', () => {
    const bad = WORDS.filter((w) => normalize(w.word) !== w.key)
    expect(bad.map((w) => w.word)).toEqual([])
  })

  it('toda key existe no dicionário de palpites', async () => {
    const ok = await Promise.all(WORDS.map((w) => isValidGuess(w.key)))
    expect(WORDS.filter((_, i) => !ok[i]).map((w) => w.word)).toEqual([])
  })

  it('nenhuma key duplicada', () => {
    const seen = new Map<string, number>()
    for (const w of WORDS) seen.set(w.key, (seen.get(w.key) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([])
  })

  it('toda entrada tem definição', () => {
    expect(WORDS.filter((w) => !w.definition.trim())).toEqual([])
  })
})

describe('dicionário de palpites', () => {
  it('aceita palavra comum de sondagem', async () => {
    for (const w of ['CARRO', 'PLENO', 'SALSA', 'TERMO', 'LIVRO', 'PORTA'])
      expect(await isValidGuess(w), w).toBe(true)
  })

  it('rejeita ruído', async () => {
    expect(await isValidGuess('XKCDQ')).toBe(false)
    expect(await isValidGuess('ABC')).toBe(false)
  })

  it('aceita palavra comum de 6, 7 e 8 letras, para o modo difícil', async () => {
    for (const w of ['CARROS', 'CADEIRA', 'JANELAS', 'ESCRITOR', 'CAMINHOS'])
      expect(await isValidGuess(w), w).toBe(true)
  })

  it('não há dicionário fora de 5 a 8 letras', async () => {
    // o comprimento vem da resposta do dia, mas um palpite forjado pode vir de
    // qualquer tamanho: sem dicionário, a resposta é "não existe", não um erro
    expect(await isValidGuess('ABCDEFGHIJ')).toBe(false)
  })
})

describe('palavra do dia', () => {
  const at = (isoLocal: string) => Date.parse(`${isoLocal}T12:00:00-03:00`)

  it('gameId acompanha o fuso de São Paulo', () => {
    expect(gameId(Date.parse('2026-08-17T23:59:00-03:00'))).toBe('2026-08-17')
    expect(gameId(Date.parse('2026-08-18T00:01:00-03:00'))).toBe('2026-08-18')
  })

  it('gameNumber avança de um em um', () => {
    expect(gameNumber(at('2026-08-18')) - gameNumber(at('2026-08-17'))).toBe(1)
  })

  it('o dia do lançamento é o #1, não o #0', () => {
    // é número que a pessoa lê no header e compartilha: começa onde ela espera
    expect(gameNumber(at('2026-08-17'))).toBe(1)
    expect(gameNumber(at('2026-08-18'))).toBe(2)
    expect(gameNumber(at('2026-09-16'))).toBe(31)
  })

  it('vira o número junto com a meia-noite de São Paulo', () => {
    expect(gameNumber(Date.parse('2026-08-17T23:59:00-03:00'))).toBe(1)
    expect(gameNumber(Date.parse('2026-08-18T00:00:00-03:00'))).toBe(2)
  })

  it('é estável dentro do dia e muda entre dias', () => {
    const a = answerFor(Date.parse('2026-08-17T00:05:00-03:00'))
    const b = answerFor(Date.parse('2026-08-17T23:55:00-03:00'))
    const c = answerFor(at('2026-08-18'))
    expect(a.key).toBe(b.key)
    expect(a.key).not.toBe(c.key)
  })

  it('não repete palavra dentro de um ciclo completo', () => {
    const start = at('2026-08-17')
    const keys = Array.from({ length: WORDS.length }, (_, i) =>
      answerFor(start + i * 86_400_000).key,
    )
    expect(new Set(keys).size).toBe(WORDS.length)
  })

  it('a ordem não é a do array', () => {
    expect(answerFor(at('2026-08-17')).key).not.toBe(WORDS[0].key)
  })

  it('a palavra de estreia é CREDO', () => {
    // fixa a âncora: se alguém mexer em LAUNCH, na seed ou na ordem da lista,
    // este teste cai antes de o jogo renumerar todo mundo em produção
    expect(gameNumber(at('2026-08-17'))).toBe(1)
    expect(answerFor(at('2026-08-17')).word).toBe('CREDO')
  })

  /**
   * Sequência congelada do lote de lançamento: os jogos #1 a #68, na ordem em
   * que o jogo os serviu desde a estreia. Acrescentar palavras a `words.ts`
   * não pode mexer em nenhuma delas — quem jogou o #7 e compartilhou o
   * resultado tem que continuar tendo jogado a mesma palavra.
   *
   * Se este teste cair depois de você acrescentar palavras, a lista foi
   * reembaralhada inteira: as entradas novas vão no FIM de `words.ts` e num
   * lote NOVO em BATCHES, nunca esticando um lote fechado.
   */
  const LOTE_DE_LANCAMENTO = [
    'CREDO', 'SALVE', 'ICONE', 'FERIA', 'PADRE', 'SANTO',
    'NIMBO', 'GRACA', 'CORAL', 'RITOS', 'MAGOS', 'CISMA',
    'TERCA', 'SINAL', 'PRIOR', 'AMBAO', 'AMITO', 'MITRA',
    'FONTE', 'SALMO', 'BISPO', 'HINOS', 'MISSA', 'CULTO',
    'CINZA', 'CAPUZ', 'DOGMA', 'PAULO', 'TRONO', 'SEXTA',
    'SINOS', 'LENHO', 'CANON', 'CANTO', 'ABADE', 'ATRIO',
    'MANTO', 'UNCAO', 'LINHO', 'PALMA', 'ORDEM', 'NATAL',
    'PALIO', 'ORGAO', 'KYRIE', 'PALIA', 'RAMOS', 'SIMAO',
    'ANDRE', 'LUCAS', 'PRECE', 'VINHO', 'CULPA', 'ALTAR',
    'VOTOS', 'CLERO', 'MONGE', 'AGNUS', 'REGRA', 'JEJUM',
    'CURIA', 'CIRIO', 'VELAS', 'CORPO', 'LEIGO', 'TIAGO',
    'PEDRO', 'MARIA',
  ]

  it('acrescentar palavras não mexe nos dias já servidos', () => {
    const start = at('2026-08-17')
    const servidas = LOTE_DE_LANCAMENTO.map((_, i) => answerFor(start + i * 86_400_000).key)
    expect(servidas).toEqual(LOTE_DE_LANCAMENTO)
  })

  it('todo dia tem resposta: os lotes cobrem a lista inteira', () => {
    // o próprio módulo estoura se BATCHES e WORDS divergirem; aqui é a rede
    // que faz isso cair no CI e não no primeiro acesso da manhã
    const start = at('2026-08-17')
    const ciclo = Array.from({ length: WORDS.length }, (_, i) =>
      answerFor(start + i * 86_400_000),
    )
    expect(ciclo.filter((e) => !e?.key)).toEqual([])
  })

  it('nextRolloverAt cai na meia-noite seguinte em São Paulo', () => {
    const now = Date.parse('2026-08-17T22:00:00-03:00')
    expect(nextRolloverAt(now)).toBe(Date.parse('2026-08-18T00:00:00-03:00'))
    expect(gameId(nextRolloverAt(now))).toBe('2026-08-18')
  })
})


describe('modo difícil', () => {
  const at = (isoLocal: string) => Date.parse(`${isoLocal}T12:00:00-03:00`)

  it('é lista própria, sem cruzar com a do modo normal', () => {
    const normais = new Set(WORDS.map((w) => w.key))
    expect(WORDS_HARD.filter((w) => normais.has(w.key)).map((w) => w.word)).toEqual([])
  })

  it('toda key tem de 6 a 8 letras e é a normalização da palavra', () => {
    const bad = WORDS_HARD.filter(
      (w) => !/^[A-Z]{6,8}$/.test(w.key) || normalize(w.word) !== w.key,
    )
    expect(bad.map((w) => w.word)).toEqual([])
  })

  it('nenhuma key duplicada e toda entrada tem definição', () => {
    const seen = new Map<string, number>()
    for (const w of WORDS_HARD) seen.set(w.key, (seen.get(w.key) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([])
    expect(WORDS_HARD.filter((w) => !w.definition.trim())).toEqual([])
  })

  it('toda key existe no dicionário do próprio comprimento', async () => {
    const ok = await Promise.all(WORDS_HARD.map((w) => isValidGuess(w.key)))
    expect(WORDS_HARD.filter((_, i) => !ok[i]).map((w) => w.word)).toEqual([])
  })

  it('os três comprimentos aparecem em proporção parecida', () => {
    // sem isso o modo vira "quase sempre 8 letras" e o tabuleiro nunca muda —
    // o comprimento variável é o ponto do modo, então ele precisa variar
    const n = (len: number) => WORDS_HARD.filter((w) => w.key.length === len).length
    for (const len of [6, 7, 8]) {
      expect(n(len), `${len} letras`).toBeGreaterThanOrEqual(WORDS_HARD.length / 6)
    }
    expect(n(6) + n(7) + n(8)).toBe(WORDS_HARD.length)
  })

  it('serve palavra do difícil, e nunca a mesma do normal no mesmo dia', () => {
    const start = at('2026-08-17')
    for (let i = 0; i < 40; i++) {
      const t = start + i * 86_400_000
      const hard = answerFor(t, 'hard')
      expect(hard.key.length).toBeGreaterThanOrEqual(6)
      expect(hard.key).not.toBe(answerFor(t, 'normal').key)
    }
  })

  it('não repete palavra dentro de um ciclo completo', () => {
    const start = at('2026-08-17')
    const keys = Array.from(
      { length: WORDS_HARD.length },
      (_, i) => answerFor(start + i * 86_400_000, 'hard').key,
    )
    expect(new Set(keys).size).toBe(WORDS_HARD.length)
  })

  it('a estreia serve a primeira palavra da lista, não o meio dela', () => {
    // sem a âncora HARD_DEBUT o índice seria o mesmo contador de dias do
    // normal, e o modo estrearia na 24ª palavra do embaralhamento — nada se
    // perderia, mas a lista curada entraria girada
    expect(answerFor(at('2026-09-09'), 'hard').word).toBe('CUSTÓDIA')
  })

  it('a partir da estreia, o ciclo passa por todas as palavras', () => {
    const debut = at('2026-09-09')
    const keys = Array.from(
      { length: WORDS_HARD.length },
      (_, i) => answerFor(debut + i * 86_400_000, 'hard').key,
    )
    expect(new Set(keys).size).toBe(WORDS_HARD.length)
  })

  it('o modo normal é o padrão de answerFor', () => {
    expect(answerFor(at('2026-08-17')).key).toBe(answerFor(at('2026-08-17'), 'normal').key)
  })

  it('7 tentativas no difícil, 6 no normal', () => {
    expect(MAX_ATTEMPTS.hard).toBe(7)
    expect(MAX_ATTEMPTS.normal).toBe(6)
  })

  it('isMode só aceita os dois modos', () => {
    expect(isMode('normal')).toBe(true)
    expect(isMode('hard')).toBe(true)
    // query string é entrada de usuário: "?mode=facil" não pode virar modo
    for (const v of ['facil', '', undefined, null, 1, {}]) expect(isMode(v), String(v)).toBe(false)
  })

  it('a coloração acompanha o comprimento da resposta, não uma constante', () => {
    expect(grade('TURIBULO', 'TURIBULO')).toEqual(Array(8).fill('correct'))
    expect(grade('ESTOLA', 'ESTOLA').length).toBe(6)
    expect(grade('LAUDES', 'MATINAS').length).toBe(7) // usa o tamanho da resposta
  })

  it('nenhuma definição do difícil usa "rezar"', () => {
    expect(WORDS_HARD.filter((w) => /\brez/i.test(w.definition)).map((w) => w.word)).toEqual([])
  })
})

describe('sessão assinada', () => {

  it('vai e volta', () => {
    const s = {
      id: '2026-08-17',
      guesses: ['SALMO'],
      status: 'playing' as const,
      mode: 'normal' as const,
    }
    expect(unseal(seal(s))).toEqual(s)
  })

  it('cookie antigo, sem o campo de modo, vale como partida normal', () => {
    // é o cookie de quem está no meio de uma partida na hora do deploy
    const antigo = seal({ id: '2026-08-17', guesses: ['SALMO'], status: 'playing' } as never)
    expect(unseal(antigo)).toEqual({
      id: '2026-08-17',
      guesses: ['SALMO'],
      status: 'playing',
      mode: 'normal',
    })
  })

  it('cookie de um modo não vale no outro', () => {
    // os dois são assinados com a mesma chave: sem o campo de modo, colar o
    // cookie do normal em `ordle_h` daria a vitória de graça no difícil
    const normal = unseal(
      seal({ id: '2026-08-17', guesses: [], status: 'won', mode: 'normal' }),
    )
    expect(normal?.mode).toBe('normal')
    const hard = unseal(seal({ id: '2026-08-17', guesses: [], status: 'won', mode: 'hard' }))
    expect(hard?.mode).toBe('hard')
  })

  it('rejeita corpo adulterado', () => {
    const token = seal({ id: '2026-08-17', guesses: [], status: 'playing', mode: 'normal' })
    const [, sig] = token.split('.')
    const forged =
      Buffer.from(
        JSON.stringify({ id: '2026-08-17', guesses: [], status: 'won', mode: 'normal' }),
      ).toString(
        'base64url',
      ) + `.${sig}`
    expect(unseal(forged)).toBeNull()
  })

  it('rejeita lixo', () => {
    expect(unseal(undefined)).toBeNull()
    expect(unseal('')).toBeNull()
    expect(unseal('semponto')).toBeNull()
    expect(unseal('a.b')).toBeNull()
  })
})

describe('teclado', () => {
  it('correct nunca vira present', () => {
    const keys = keyboardState(
      ['SALMO', 'SANTO'],
      [
        ['correct', 'absent', 'absent', 'absent', 'absent'],
        ['present', 'absent', 'absent', 'absent', 'absent'],
      ],
    )
    expect(keys.S).toBe('correct')
  })

  it('absent sobe para present', () => {
    const keys = keyboardState(
      ['SALMO', 'MISSA'],
      [
        ['absent', 'absent', 'absent', 'absent', 'absent'],
        ['present', 'absent', 'absent', 'absent', 'absent'],
      ],
    )
    expect(keys.M).toBe('present')
  })
})

describe('compartilhamento', () => {
  const results = [
    ['absent', 'present', 'absent', 'absent', 'correct'],
    ['correct', 'correct', 'correct', 'correct', 'correct'],
  ] as const

  it('vitória conta em quantas tentativas', () => {
    const text = shareText({
      gameNumber: 142,
      results: results as never,
      status: 'won',
      url: 'ofício.app',
    })
    expect(text).toBe(
      'Acertei o Ordle #142 em 2 tentativas.\n\n⬜🟨⬜⬜🟩\n🟩🟩🟩🟩🟩\n\nofício.app',
    )
  })

  it('acerto de primeira não fica no singular errado', () => {
    // "em 1 tentativas" é o vacilo clássico de template
    expect(shareHeadline(7, 1, 'won')).toBe('Acertei o Ordle #7 de primeira!')
    expect(shareHeadline(7, 2, 'won')).toBe('Acertei o Ordle #7 em 2 tentativas.')
  })

  it('o difícil aparece no texto compartilhado', () => {
    expect(shareHeadline(7, 3, 'won', 'hard')).toBe('Acertei o Ordle #7 no difícil em 3 tentativas.')
    expect(shareHeadline(7, 1, 'won', 'hard')).toBe('Acertei o Ordle #7 no difícil de primeira!')
    // sem o modo, nada muda para quem joga o normal
    expect(shareHeadline(7, 3, 'won')).toBe('Acertei o Ordle #7 em 3 tentativas.')
  })

  it('derrota não expõe contagem de tentativas', () => {
    const text = shareText({ gameNumber: 142, results: results as never, status: 'lost' })
    expect(text).toContain('Não acertei o Ordle #142 hoje.')
    expect(text).not.toMatch(/tentativas/)
  })

  it('tema escuro usa ⬛', () => {
    const text = shareText({ gameNumber: 1, results: results as never, status: 'won', dark: true })
    expect(text).toContain('⬛')
    expect(text).not.toContain('⬜')
  })

  it('nunca vaza a resposta', () => {
    const text = shareText({ gameNumber: 1, results: results as never, status: 'won' })
    expect(/[A-Z]{5}/.test(text.replace('Ordle', ''))).toBe(false)
  })
})

describe('calendário litúrgico (fallback local)', () => {
  it('calcula a Páscoa', () => {
    expect(new Date(easter(2026)).toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(new Date(easter(2027)).toISOString().slice(0, 10)).toBe('2027-03-28')
  })

  it('Quaresma é roxa, Laetare é rosa', () => {
    expect(computeLiturgicalDay('2026-02-18').color).toBe('purple') // Cinzas
    expect(computeLiturgicalDay('2026-03-15').color).toBe('rose') // Laetare
  })

  it('Advento é roxo e Gaudete é rosa', () => {
    expect(computeLiturgicalDay('2026-12-06').color).toBe('purple')
    expect(computeLiturgicalDay('2026-12-13').color).toBe('rose')
  })

  it('Páscoa é branca e Pentecostes é vermelho', () => {
    expect(computeLiturgicalDay('2026-04-05').color).toBe('white')
    expect(computeLiturgicalDay('2026-05-24').color).toBe('red')
  })

  it('Tempo Comum é verde', () => {
    expect(computeLiturgicalDay('2026-08-17').color).toBe('green')
  })

  it('festa de apóstolo cede ao domingo, festa principal não', () => {
    // conferido contra a API: 18/10/2026 (Lucas, domingo) devolve verde,
    // e 01/11/2026 (Todos os Santos, domingo) devolve branco
    expect(computeLiturgicalDay('2026-10-18').color).toBe('green')
    expect(computeLiturgicalDay('2026-11-01').color).toBe('white')
    // fora do domingo, a festa de apóstolo pinta normalmente
    expect(computeLiturgicalDay('2026-06-29').color).toBe('red')
  })

  it('traduz as cores da API', () => {
    expect(parseColor('verde')).toBe('green')
    expect(parseColor('Roxo')).toBe('purple')
    expect(parseColor('dourado')).toBe('white')
    expect(parseColor('chartreuse')).toBeNull()
    expect(parseColor(42)).toBeNull()
  })
})

/**
 * Os payloads abaixo são recortes de respostas reais de
 * GET /api/v1/calendar/:ano/:mes/:dia?preferences[prayer_book_code]=loc_2015
 * (só os campos que o Ordle lê; readings e collect foram descartados).
 */
describe('extractDay (payload real do Caminho Anglicano)', () => {
  it('féria: sem celebração e sem domingo, cai em Féria', () => {
    const day = extractDay(
      {
        liturgical_season: 'Tempo Comum',
        liturgical_color: 'verde',
        celebration: null,
        sunday_name: null,
        description: ['Próprio 15', '20ª Semana do Tempo Comum'],
      },
      '2026-08-17',
    )
    expect(day).toEqual({ color: 'green', season: 'Tempo Comum', celebration: 'Féria' })
  })

  it('pega o salmo do dia, que é o gancho do Ordo', () => {
    const day = extractDay(
      {
        liturgical_color: 'verde',
        liturgical_season: 'Tempo Comum',
        readings: { psalm: { reference: 'Salmo 130', chapter: 130 } },
      },
      '2026-08-17',
    )
    expect(day?.psalm).toBe('Salmo 130')
  })

  it('sem salmo no payload, o campo simplesmente não vem', () => {
    const semLeituras = extractDay({ liturgical_color: 'verde' }, '2026-08-17')
    const semSalmo = extractDay({ liturgical_color: 'verde', readings: {} }, '2026-08-17')
    expect(semLeituras).not.toHaveProperty('psalm')
    expect(semSalmo).not.toHaveProperty('psalm')
  })

  it('domingo comum: nomeia pelo sunday_name', () => {
    const day = extractDay(
      {
        liturgical_season: 'Tempo Comum',
        liturgical_color: 'verde',
        celebration: null,
        sunday_name: '12º Domingo no Tempo Comum',
      },
      '2026-08-23',
    )
    expect(day?.celebration).toBe('12º Domingo no Tempo Comum')
  })

  it('festa que rege o dia vence o domingo (Todos os Santos)', () => {
    const day = extractDay(
      {
        liturgical_season: 'Tempo Comum',
        liturgical_color: 'branco',
        celebration: { name: 'Todos os Santos e Santas', color: 'branco', type: 'principal_feast' },
        sunday_name: '22º Domingo no Tempo Comum',
      },
      '2026-11-01',
    )
    expect(day).toEqual({
      color: 'white',
      season: 'Tempo Comum',
      celebration: 'Todos os Santos e Santas',
    })
  })

  it('festa que cede ao domingo não nomeia o dia (Lucas em domingo comum)', () => {
    // celebration.color branco ≠ liturgical_color verde: quem rege é o domingo
    const day = extractDay(
      {
        liturgical_season: 'Tempo Comum',
        liturgical_color: 'verde',
        celebration: { name: 'Lucas', color: 'branco', type: 'festival' },
        sunday_name: '20º Domingo no Tempo Comum',
      },
      '2026-10-18',
    )
    expect(day).toEqual({
      color: 'green',
      season: 'Tempo Comum',
      celebration: '20º Domingo no Tempo Comum',
    })
  })

  it('Gaudete: a cor sai do dia, não da celebração', () => {
    // o dia é rosa; Luzia, memória do dia, é vermelha. Ler celebration.color
    // pintaria o header de vermelho no meio do Advento
    const day = extractDay(
      {
        liturgical_season: 'Advento',
        liturgical_color: 'rosa',
        celebration: { name: 'Luzia', color: 'vermelho', type: 'lesser_feast' },
        sunday_name: '3º Domingo do Advento',
      },
      '2026-12-13',
    )
    expect(day).toEqual({
      color: 'rose',
      season: 'Advento',
      celebration: '3º Domingo do Advento',
    })
  })

  it('Sexta-feira da Paixão', () => {
    const day = extractDay(
      {
        liturgical_season: 'Quaresma',
        liturgical_color: 'vermelho',
        celebration: { name: 'Sexta-Feira da Paixão', color: 'vermelho', type: 'major_holy_day' },
        sunday_name: null,
      },
      '2026-04-03',
    )
    expect(day).toEqual({
      color: 'red',
      season: 'Quaresma',
      celebration: 'Sexta-Feira da Paixão',
    })
  })

  it('devolve null quando a cor não dá para reconhecer', () => {
    // melhor cair no cálculo local do que pintar o header de uma cor errada
    expect(extractDay({ liturgical_season: 'Tempo Comum' }, '2026-08-17')).toBeNull()
    expect(extractDay({ liturgical_color: 'turquesa' }, '2026-08-17')).toBeNull()
    expect(extractDay(null, '2026-08-17')).toBeNull()
    expect(extractDay([1, 2, 3], '2026-08-17')).toBeNull()
  })

  it('devolve null nos erros da própria API', () => {
    expect(
      extractDay({ error: { code: 'APP_VERIFICATION_REQUIRED' }, success: false }, '2026-08-17'),
    ).toBeNull()
    expect(
      extractDay({ success: false, error: { code: 'PRAYER_BOOK_REQUIRED' } }, '2026-08-17'),
    ).toBeNull()
  })
})

describe('segredo da sessão (fail-closed)', () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = { ...process.env }
    Object.assign(process.env, env)
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]
    try {
      fn()
    } finally {
      process.env = saved
    }
  }

  it('sem ORDLE_SECRET, só dev e test usam a chave pública', async () => {
    await withEnv({ ORDLE_SECRET: undefined, NODE_ENV: 'development' }, () => {
      expect(() => seal({ id: 'x', guesses: [], status: 'playing', mode: 'normal' })).not.toThrow()
    })
  })

  it('sem ORDLE_SECRET e sem NODE_ENV, estoura em vez de assinar', async () => {
    // NODE_ENV vazio ou 'preview' não pode cair na chave pública do repo:
    // com ela qualquer um forja um cookie com status 'won'
    for (const env of [undefined, 'preview', 'production', 'staging']) {
      await withEnv({ ORDLE_SECRET: undefined, NODE_ENV: env }, () => {
        expect(
          () => seal({ id: 'x', guesses: [], status: 'playing', mode: 'normal' }),
          String(env),
        ).toThrow(
          /ORDLE_SECRET/,
        )
      })
    }
  })

  it('rejeita segredo curto demais', async () => {
    await withEnv({ ORDLE_SECRET: 'curto', NODE_ENV: 'production' }, () => {
      expect(() => seal({ id: 'x', guesses: [], status: 'playing', mode: 'normal' })).toThrow(
        /ORDLE_SECRET/,
      )
    })
  })

  it('cookie sai secure fora de dev', async () => {
    await withEnv({ NODE_ENV: 'production' }, () => expect(cookieOptions().secure).toBe(true))
    await withEnv({ NODE_ENV: undefined }, () => expect(cookieOptions().secure).toBe(true))
    await withEnv({ NODE_ENV: 'development' }, () => expect(cookieOptions().secure).toBe(false))
  })
})

describe('detectPlatform (destino do gancho do Ordo)', () => {
  const UA = {
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipadAntigo:
      'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
    // iPadOS 13+ se apresenta como Macintosh: só o UA não distingue
    ipadNovo:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    windowsTouch:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  }

  it('celular vai para a loja da plataforma', () => {
    expect(detectPlatform(UA.iphone)).toBe('ios')
    expect(detectPlatform(UA.ipadAntigo)).toBe('ios')
    expect(detectPlatform(UA.android, 5)).toBe('android')
  })

  it('iPad novo é reconhecido pelo touch, já que o UA diz Macintosh', () => {
    expect(detectPlatform(UA.ipadNovo, 5)).toBe('ios')
    expect(detectPlatform(UA.ipadNovo, 0)).toBe('desktop')
  })

  it('desktop vai para o site', () => {
    expect(detectPlatform(UA.mac)).toBe('desktop')
    expect(detectPlatform(UA.windowsTouch)).toBe('desktop')
  })

  it('notebook Windows com tela de toque não vira celular', () => {
    // a heurística de touch vale só para o UA de Mac; sem essa restrição um
    // Surface cairia na App Store
    expect(detectPlatform(UA.windowsTouch, 10)).toBe('desktop')
  })

  it('UA desconhecido cai no desktop, que é o destino que sempre funciona', () => {
    expect(detectPlatform('')).toBe('desktop')
    expect(detectPlatform('curl/8.4.0')).toBe('desktop')
  })
})

describe('vocabulário', () => {
  it('nenhuma definição usa "rezar", marcado como católico', () => {
    // o Ordo também atende público evangélico: "orar" e "o Ofício traz"
    // passam em qualquer tradição
    const comReza = WORDS.filter((w) => /\brez/i.test(w.definition))
    expect(comReza.map((w) => `${w.word}: ${w.definition}`)).toEqual([])
  })
})
