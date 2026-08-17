import raw from './pt-5.json'
import { WORDS } from './words'

/**
 * Palpites válidos: dicionário pt-BR amplo de 5 letras, normalizado.
 *
 * Fonte: pt_BR do Hunspell (VERO/LibreOffice), com os afixos expandidos,
 * filtrado por /^[A-Z]{5}$/ depois de normalizar. Ver scripts/build-dictionary.mjs.
 *
 * O conjunto de palpites tem que conter o de respostas — daí o segundo laço.
 * Sem isso, um termo litúrgico que o Hunspell não conhece (KYRIE, AGNUS) seria
 * rejeitado como "palavra não encontrada" no dia em que fosse a resposta.
 */
const VALID = new Set<string>(raw as string[])
for (const entry of WORDS) VALID.add(entry.key)

export const isValidGuess = (key: string) => VALID.has(key)

export const dictionarySize = () => VALID.size
