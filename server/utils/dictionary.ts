import { WORDS } from './words'
import { WORDS_HARD } from './words-hard'

/**
 * Palpites válidos: dicionário pt-BR amplo, um arquivo por comprimento.
 *
 * Fonte: pt_BR do Hunspell (VERO/LibreOffice), com os afixos expandidos,
 * filtrado por comprimento depois de normalizar. Ver scripts/build-dictionary.mjs.
 *
 * O carregamento é preguiçoso e por comprimento porque o modo difícil sorteia
 * o tamanho do dia: juntos são 3,2 MB para parsear em todo cold start, sendo
 * que num dado dia o jogo usa dois tamanhos (5 no normal, um dos três no
 * difícil). O import dinâmico vira chunk separado no build, então o dia que
 * sorteia 6 letras nunca toca no arquivo de 8.
 *
 * O conjunto de palpites tem que conter o de respostas — daí o segundo laço.
 * Sem isso, um termo litúrgico que o Hunspell não conhece (KYRIE, AGNUS) seria
 * rejeitado como "palavra não encontrada" no dia em que fosse a resposta.
 */
const LOADERS: Record<number, () => Promise<{ default: string[] }>> = {
  5: () => import('./pt-5.json'),
  6: () => import('./pt-6.json'),
  7: () => import('./pt-7.json'),
  8: () => import('./pt-8.json'),
}

export const LENGTHS = Object.keys(LOADERS).map(Number)

const cache = new Map<number, Promise<Set<string>>>()

function build(length: number): Promise<Set<string>> {
  const load = LOADERS[length]
  if (!load) return Promise.resolve(new Set())
  return load().then(({ default: raw }) => {
    const set = new Set(raw)
    for (const entry of [...WORDS, ...WORDS_HARD]) if (entry.key.length === length) set.add(entry.key)
    return set
  })
}

/**
 * A Promise é que fica em cache, não o Set: duas requisições simultâneas num
 * processo frio compartilham o mesmo carregamento em vez de parsear o arquivo
 * duas vezes.
 */
export function validGuesses(length: number): Promise<Set<string>> {
  let hit = cache.get(length)
  if (!hit) {
    hit = build(length)
    cache.set(length, hit)
  }
  return hit
}

export const isValidGuess = async (key: string) => (await validGuesses(key.length)).has(key)

export const dictionarySize = async (length: number) => (await validGuesses(length)).size
