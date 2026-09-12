import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import { TRAIT_CLAUSES, bandOf, dnaText } from '../src/lineage/genome'
import {
  ACT_CONTRACT,
  PROMPT_CHAR_CAP,
  WORLD_RULES_TEXT,
  buildSystemPrompt,
  buildUserPrompt,
  parseIntent,
} from '../src/lineage/prompt'
import { observe } from '../src/lineage/step'
import { TRAIT_NAMES } from '../src/lineage/types'
import { createHamlet, mergeConfig } from '../src/lineage/world'
import { DEFAULT_CONFIG } from '../src/lineage/types'

describe('lineage prompt', () => {
  it('system with dna:true contains dnaText verbatim; dna:false contains none of its clauses', () => {
    const rng = createRng(42)
    const state = createHamlet(mergeConfig({ seed: 42 }), rng)
    const v = state.villagers[0]!
    const dna = dnaText(v.traits)
    const on = buildSystemPrompt(v, { dna: true }, state.lineage)
    const off = buildSystemPrompt(v, { dna: false }, state.lineage)
    expect(on).toContain(dna)
    expect(off).not.toContain(dna)
    for (const name of TRAIT_NAMES) {
      const clause = TRAIT_CLAUSES[name][bandOf(v.traits[name])]
      expect(off).not.toContain(clause)
    }
    expect(on).toContain(ACT_CONTRACT)
    expect(off).toContain(ACT_CONTRACT)
  })

  it('world-rules text never contains should/must/trait/gene/fitness/select', () => {
    expect(WORLD_RULES_TEXT).not.toMatch(/should|must|trait|gene|fitness|select/i)
  })

  it('system + user ≤ 4400 chars on a full 12-villager state at day 5 dusk', () => {
    const rng = createRng(42)
    const events = new EventTrace()
    const state = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed: 42 }), rng, events)
    state.day = 4
    state.turn = 2
    const self = state.villagers[0]!
    state.proposals.push({
      id: 'p-0',
      rule: 'ration-granary',
      by: self.id,
      text: 'Ration the granary.',
      openedTick: 1,
      votes: { 'v-1': 'for', 'v-2': 'against', 'v-3': 'for' },
    })
    for (let i = 1; i <= 3; i++) {
      const o = state.villagers[i]!
      events.append({
        tick: 2,
        type: 'speech',
        agentId: o.id,
        data: { to: self.id, text: `Hello ${self.givenName}, the fields are dry today.` },
      })
    }
    events.append({
      tick: 3,
      type: 'turn:start',
      data: { turn: 1, name: 'noon' },
    })
    for (const kind of ['work', 'talk', 'eat', 'rest', 'store', 'give'] as const) {
      events.append({
        tick: 3,
        type: 'action:start',
        agentId: self.id,
        data: { kind },
        reason: 'I act.',
      })
      events.append({
        tick: 3,
        type: 'action:end',
        agentId: self.id,
        data: { kind },
      })
    }
    const obs = observe(state, self)
    const system = buildSystemPrompt(self, { dna: true }, state.lineage)
    const user = buildUserPrompt(obs, events.getAll())
    expect(system.length + user.length).toBeLessThanOrEqual(PROMPT_CHAR_CAP)
    expect(user).toContain('Season 1, day 5, dusk.')
    expect(user).toContain('Open proposal p-0')
    expect(system).toContain(dnaText(self.traits))
  })

  it('parseIntent accepts a fenced valid object', () => {
    const rng = createRng(1)
    const state = createHamlet(mergeConfig({ seed: 1 }), rng)
    const self = state.villagers[0]!
    const other = state.villagers[1]!
    const obs = observe(state, self)
    const text = [
      'Sure.',
      '```json',
      JSON.stringify({
        action: 'talk',
        target: other.givenName,
        text: 'The day is long.',
        reason: 'I want company.',
      }),
      '```',
    ].join('\n')
    const parsed = parseIntent(text, obs)
    expect(parsed).toHaveProperty('intent')
    if ('intent' in parsed) {
      expect(parsed.intent.kind).toBe('talk')
      expect(parsed.intent.target).toBe(other.id)
    }
  })

  it('parseIntent rejects unknown action, self-target, dead target, closed proposal, missing reason with distinct errors', () => {
    const rng = createRng(2)
    const state = createHamlet(mergeConfig({ seed: 2 }), rng)
    const self = state.villagers[0]!
    const other = state.villagers[1]!
    const dead = state.villagers[2]!
    dead.status = 'departed'
    state.proposals.push({
      id: 'p-closed',
      rule: 'granary-open',
      by: other.id,
      text: 'Open.',
      openedTick: 0,
      votes: {},
      resolved: 'rejected',
    })
    const obs = observe(state, self)

    const unknown = parseIntent(JSON.stringify({ action: 'dance', reason: 'I dance.' }), obs)
    const selfT = parseIntent(
      JSON.stringify({ action: 'talk', target: self.givenName, text: 'Hi.', reason: 'I talk to me.' }),
      obs,
    )
    const deadT = parseIntent(
      JSON.stringify({
        action: 'talk',
        target: dead.givenName,
        text: 'Hi.',
        reason: 'I talk to them.',
      }),
      obs,
    )
    const closed = parseIntent(
      JSON.stringify({
        action: 'vote',
        proposalId: 'p-closed',
        choice: 'for',
        reason: 'I vote.',
      }),
      obs,
    )
    const missing = parseIntent(JSON.stringify({ action: 'idle' }), obs)

    expect(unknown).toEqual({ error: 'unknown action' })
    expect(selfT).toEqual({ error: 'self target' })
    expect(deadT).toEqual({ error: 'dead target' })
    expect(closed).toEqual({ error: 'closed proposal' })
    expect(missing).toEqual({ error: 'missing reason' })

    const errors = [unknown, selfT, deadT, closed, missing].map((r) => ('error' in r ? r.error : ''))
    expect(new Set(errors).size).toBe(5)
  })

  it('a talk with 200-char text is trimmed to 140', () => {
    const rng = createRng(3)
    const state = createHamlet(mergeConfig({ seed: 3 }), rng)
    const self = state.villagers[0]!
    const other = state.villagers[1]!
    const obs = observe(state, self)
    const long = 'x'.repeat(200)
    const parsed = parseIntent(
      JSON.stringify({
        action: 'talk',
        target: `${other.givenName} ${other.surname}`,
        text: long,
        reason: 'I talk.',
      }),
      obs,
    )
    expect('intent' in parsed).toBe(true)
    if ('intent' in parsed) {
      expect(parsed.intent.text).toBe('x'.repeat(140))
    }
  })
})
