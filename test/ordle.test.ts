import { describe, expect, it } from 'vitest'
import { WORDS } from '../server/utils/words'
import { isValidGuess } from '../server/utils/dictionary'
import { answerFor, gameId, gameNumber, grade, nextRolloverAt, normalize } from '../server/utils/ordle'
import { computeLiturgicalDay, easter, extractDay, parseColor } from '../server/utils/liturgy'
import { seal, unseal } from '../server/utils/session'
import { keyboardState, shareText } from '../app/utils/ordle-shared'

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

  it('toda key existe no dicionário de palpites', () => {
    const bad = WORDS.filter((w) => !isValidGuess(w.key))
    expect(bad.map((w) => w.word)).toEqual([])
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
  it('aceita palavra comum de sondagem', () => {
    for (const w of ['CARRO', 'PLENO', 'SALSA', 'TERMO', 'LIVRO', 'PORTA'])
      expect(isValidGuess(w), w).toBe(true)
  })

  it('rejeita ruído', () => {
    expect(isValidGuess('XKCDQ')).toBe(false)
    expect(isValidGuess('ABC')).toBe(false)
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

  it('gameNumber começa em 0 no dia 1º de janeiro de 2026', () => {
    expect(gameNumber(at('2026-01-01'))).toBe(0)
  })

  it('é estável dentro do dia e muda entre dias', () => {
    const a = answerFor(Date.parse('2026-08-17T00:05:00-03:00'))
    const b = answerFor(Date.parse('2026-08-17T23:55:00-03:00'))
    const c = answerFor(at('2026-08-18'))
    expect(a.key).toBe(b.key)
    expect(a.key).not.toBe(c.key)
  })

  it('não repete palavra dentro de um ciclo completo', () => {
    const start = at('2026-01-01')
    const keys = Array.from({ length: WORDS.length }, (_, i) =>
      answerFor(start + i * 86_400_000).key,
    )
    expect(new Set(keys).size).toBe(WORDS.length)
  })

  it('a ordem não é a do array', () => {
    expect(answerFor(at('2026-01-01')).key).not.toBe(WORDS[0].key)
  })

  it('nextRolloverAt cai na meia-noite seguinte em São Paulo', () => {
    const now = Date.parse('2026-08-17T22:00:00-03:00')
    expect(nextRolloverAt(now)).toBe(Date.parse('2026-08-18T00:00:00-03:00'))
    expect(gameId(nextRolloverAt(now))).toBe('2026-08-18')
  })
})

describe('sessão assinada', () => {
  it('vai e volta', () => {
    const s = { id: '2026-08-17', guesses: ['SALMO'], status: 'playing' as const }
    expect(unseal(seal(s))).toEqual(s)
  })

  it('rejeita corpo adulterado', () => {
    const token = seal({ id: '2026-08-17', guesses: [], status: 'playing' })
    const [, sig] = token.split('.')
    const forged =
      Buffer.from(JSON.stringify({ id: '2026-08-17', guesses: [], status: 'won' })).toString(
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

  it('vitória mostra a contagem', () => {
    const text = shareText({
      gameNumber: 142,
      results: results as never,
      status: 'won',
      url: 'ofício.app/ordle',
    })
    expect(text).toBe('Ordle #142 · 2/6\n\n⬜🟨⬜⬜🟩\n🟩🟩🟩🟩🟩\n\nofício.app/ordle')
  })

  it('derrota mostra X/6', () => {
    const text = shareText({ gameNumber: 142, results: results as never, status: 'lost' })
    expect(text).toContain('Ordle #142 · X/6')
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
