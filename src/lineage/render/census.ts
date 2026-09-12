import { bandOf } from '../genome'
import type { LineageState, TraitName } from '../types'
import { TRAIT_NAMES } from '../types'
import { fullName, grain1, livingVillagers } from '../world'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function letter(t: number): string {
  const b = bandOf(t)
  if (b === 'low') return 'L'
  if (b === 'mid') return 'M'
  return 'H'
}

export function renderCensus(state: LineageState): string {
  const living = livingVillagers(state)
  const traitHeads = TRAIT_NAMES.map((n) => n.slice(0, 3)).join(' | ')
  const header =
    `| name | gen | satiety | energy | companionship | grain | standing | ${traitHeads} | status |`
  const sep =
    `| --- | --- | --- | --- | --- | --- | --- | ${TRAIT_NAMES.map(() => '---').join(' | ')} | --- |`
  const rows = living.map((v) => {
    const bands = TRAIT_NAMES.map((n: TraitName) => letter(v.traits[n])).join(' | ')
    return `| ${fullName(v)} | ${v.generation} | ${pct(v.satiety)} | ${pct(v.energy)} | ${pct(v.companionship)} | ${grain1(v.grain)} | ${v.standing} | ${bands} | ${v.status} |`
  })
  return [header, sep, ...rows, ''].join('\n')
}
