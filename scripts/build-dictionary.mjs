#!/usr/bin/env node
/**
 * Gera `server/utils/pt-5.json` — o dicionário de palpites válidos.
 *
 * O .dic do Hunspell só traz formas base; plural, feminino e conjugação vivem
 * como flags de afixo no .aff. Sem expandir, palavras óbvias de sondagem
 * (CARRO, VELAS, REGRA) seriam rejeitadas e o jogo ficaria insuportável.
 * Então: baixa os dois arquivos, aplica as regras SFX/PFX, normaliza e guarda
 * só o que sobra com exatamente 5 letras.
 *
 *   node scripts/build-dictionary.mjs
 */
import { writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/pt_BR'
const OUT = 'server/utils/pt-5.json'

const strip = (s) => s.replace(/^﻿/, '')
const fetchText = async (name) => {
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return strip(await res.text())
}

const [affRaw, dicRaw] = await Promise.all([fetchText('pt_BR.aff'), fetchText('pt_BR.dic')])

// ---- afixos -----------------------------------------------------------
const affixes = new Map() // flag -> { type, cross, rules }
const affLines = affRaw.split(/\r?\n/)
for (let i = 0; i < affLines.length; i++) {
  const head = /^(SFX|PFX)\s+(\S+)\s+(\S+)\s+(\d+)/.exec(affLines[i])
  if (!head) continue
  const [, type, flag, crossRaw, countRaw] = head
  const count = Number(countRaw)
  const entry = { type, cross: crossRaw === 'Y', rules: [] }
  for (let j = 1; j <= count; j++) {
    const r = /^(?:SFX|PFX)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?/.exec(affLines[i + j] ?? '')
    if (!r) continue
    const stripPart = r[2] === '0' ? '' : r[2]
    const add = (r[3] === '0' ? '' : r[3]).split('/')[0]
    const condRaw = r[4] ?? '.'
    let cond
    try {
      cond = new RegExp(type === 'SFX' ? `${condRaw}$` : `^${condRaw}`)
    } catch {
      cond = /(?:)/
    }
    entry.rules.push({ strip: stripPart, add, cond })
  }
  i += count
  affixes.set(flag, entry)
}

// ---- expansão ---------------------------------------------------------
const normalize = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()

const WORD = /^[a-zà-öø-ÿ]+$/i
const out = new Set()

const keep = (w) => {
  if (!WORD.test(w)) return
  const k = normalize(w)
  if (/^[A-Z]{5}$/.test(k)) out.add(k)
}

const applySfx = (word, rule) => {
  if (rule.strip && !word.endsWith(rule.strip)) return null
  if (!rule.cond.test(word)) return null
  return word.slice(0, word.length - rule.strip.length) + rule.add
}
const applyPfx = (word, rule) => {
  if (rule.strip && !word.startsWith(rule.strip)) return null
  if (!rule.cond.test(word)) return null
  return rule.add + word.slice(rule.strip.length)
}

for (const line of dicRaw.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue
  const slash = line.indexOf('/')
  const base = (slash === -1 ? line : line.slice(0, slash)).trim()
  if (!base) continue
  keep(base)
  if (slash === -1) continue

  const flags = [...line.slice(slash + 1).trim()] // FLAG UTF-8: uma flag por caractere
  const crossable = []

  for (const f of flags) {
    const a = affixes.get(f)
    if (a?.type !== 'SFX') continue
    for (const rule of a.rules) {
      const w = applySfx(base, rule)
      if (!w) continue
      keep(w)
      if (a.cross) crossable.push(w)
    }
  }
  for (const f of flags) {
    const a = affixes.get(f)
    if (a?.type !== 'PFX') continue
    for (const rule of a.rules) {
      const w = applyPfx(base, rule)
      if (w) keep(w)
      if (!a.cross) continue
      for (const s of crossable) {
        const cw = applyPfx(s, rule)
        if (cw) keep(cw)
      }
    }
  }
}

const list = [...out].sort()
writeFileSync(OUT, JSON.stringify(list))
console.log(`✓ ${list.length} palavras em ${OUT}`)
console.log('  (as respostas de words.ts entram no Set em dictionary.ts, não aqui)')
