import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import { serializeSave, restoreSave } from '../src/sim/persist'
import {
  SLEEP_BED_ENERGY,
  SLEEP_GROUND_ENERGY,
  examineKnowledgeFor,
} from '../src/sim/examine'
import type { ExternalIntentMeta, Intent, Place } from '../src/sim/types'
import { parseMindJson, parseReflectionJson, resolveMindIntent } from '../src/mind/parse'
import {
  compileKnowledge,
  feltConsequenceLines,
  feltLineFromEvent,
  knowledgeLinesForPrompt,
} from '../src/mind/knowledge'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'
import { episodicMemories } from '../src/mind/memory'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

describe('discovery layer — felt consequences', () => {
  it('derives before/after felt lines from action:end and wages', () => {
    const eat = feltLineFromEvent(
      {
        seq: 1,
        tick: 10,
        type: 'action:end',
        agentId: 'agent-0',
        data: { kind: 'eat', before: 0.34, after: 0.79 },
      },
      'agent-0',
    )
    expect(eat).toBe('ate berries: hunger 34%→79%')

    const bed = feltLineFromEvent(
      {
        seq: 2,
        tick: 20,
        type: 'action:end',
        agentId: 'agent-0',
        data: { kind: 'sleep', before: 0.22, after: 0.96, shelter: 'bed' },
      },
      'agent-0',
    )
    expect(bed).toBe('slept in your bed: energy 22%→96%')

    const ground = feltLineFromEvent(
      {
        seq: 3,
        tick: 21,
        type: 'action:end',
        agentId: 'agent-0',
        data: { kind: 'sleep', before: 0.2, after: 0.52, shelter: 'ground' },
      },
      'agent-0',
    )
    expect(ground).toBe('slept on the ground: energy 20%→52%')

    const drink = feltLineFromEvent(
      {
        seq: 4,
        tick: 30,
        type: 'action:end',
        agentId: 'agent-0',
        data: { kind: 'drink', before: 0.5, after: 0.58 },
      },
      'agent-0',
    )
    expect(drink).toBe('drank at the well: energy +8%')

    const wage = feltLineFromEvent(
      {
        seq: 5,
        tick: 40,
        type: 'coins:transfer',
        agentId: 'agent-0',
        data: { from: 'treasury', to: 'agent-0', amount: 6, kind: 'wage', placeKind: 'quarry' },
      },
      'agent-0',
    )
    expect(wage).toBe('worked the quarry: +6 coins at day\'s end')
  })

  it('live eat writes before/after and a Recently felt line', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(80)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.inventory.food = 2
    agent.needs.hunger = 0.34
    const before = agent.needs.hunger
    const tickBefore = sim.state.tick
    sim.postExternalIntent(
      'agent-0',
      { kind: 'eat', reason: 'I will eat these berries.' },
      meta('I will eat these berries.'),
    )
    for (let i = 0; i < 40; i++) {
      sim.advanceTicks(1)
      const ended = sim.getEvents().some(
        (e) =>
          e.tick > tickBefore &&
          e.type === 'action:end' &&
          e.agentId === 'agent-0' &&
          e.data?.kind === 'eat' &&
          typeof e.data?.before === 'number',
      )
      if (ended) break
    }
    const end = [...sim.getEvents()]
      .reverse()
      .find(
        (e) =>
          e.tick > tickBefore &&
          e.type === 'action:end' &&
          e.data?.kind === 'eat' &&
          e.agentId === 'agent-0',
      )
    expect(end).toBeTruthy()
    expect(end!.data?.before).toBeCloseTo(before, 2)
    expect(typeof end!.data?.after).toBe('number')
    expect(end!.data?.after).toBeGreaterThan(before)
    const felt = feltConsequenceLines('agent-0', sim.getEvents(), sim.state.tick)
    expect(felt.some((l) => l.startsWith('ate berries: hunger'))).toBe(true)
    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain('Recently felt:')
    expect(user).toMatch(/ate berries: hunger \d+%→\d+%/)
  })
})

describe('discovery layer — knowledge store', () => {
  it('same trace+notes+says → same Known lines', () => {
    const sim = new Simulation(7)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'examine',
        targetPlaceId: board.id,
        targetX: board.x,
        targetY: board.y,
        reason: 'I will look at that post.',
      },
      meta('I will look at that post.'),
    )
    for (let i = 0; i < 80; i++) {
      sim.advanceTicks(1)
      if (sim.getEvents().some((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0')) {
        break
      }
    }
    sim.postMindNotes(
      'agent-0',
      ['I should look around more.'],
      { provider: 'mock', latencyMs: 1 },
      ['Berries fill me when I eat them.'],
    )
    sim.advanceTicks(1)
    sim.postSay('c1', 'agent-1', 'agent-0', 0, 'The well wakes you a little.', true)
    sim.advanceTicks(1)

    const events = sim.getEvents()
    const notes = sim.state.mindNoteLog
    const a = knowledgeLinesForPrompt('agent-0', events, notes, 6)
    const b = knowledgeLinesForPrompt('agent-0', events, notes, 6)
    expect(a).toEqual(b)
    expect(a.some((l) => /propose/i.test(l) || /board/i.test(l) || /Anyone may/.test(l))).toBe(
      true,
    )
    expect(a).toContain('Berries fill me when I eat them.')
    expect(a.some((l) => l.includes('The well wakes you a little.'))).toBe(true)
    const facts = compileKnowledge('agent-0', events, notes)
    expect(facts.filter((f) => f.source === 'examine').length).toBeGreaterThanOrEqual(1)
  })
})

describe('discovery layer — examine + board', () => {
  it('worldgen places an examinable notice-board', () => {
    const sim = new Simulation(42)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')
    expect(board).toBeTruthy()
    expect(board!.id).toBe('notice-board-0')
    expect(examineKnowledgeFor(board as Place)).toMatch(/propose/i)
    expect(examineKnowledgeFor(board as Place)).toMatch(/vote/i)
    const kinds = [
      'berry-bush',
      'well',
      'farm',
      'stall',
      'storehouse',
      'home',
      'quarry',
      'forestry',
      'plaza',
      'construction-site',
      'notice-board',
    ] as const
    for (const kind of kinds) {
      const p = sim.state.places.find((x) => x.kind === kind)
      if (!p) continue
      const text = examineKnowledgeFor(p)
      expect(text.length).toBeGreaterThan(8)
    }
  })

  it('examine walks, emits discovery:examined, lands knowledge + episodic', () => {
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const parsed = parseMindJson(
      JSON.stringify({
        action: 'examine',
        target: 'notice-board',
        reasoning: 'I will look at that wooden post.',
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const intent = resolveMindIntent(sim.state, mira, parsed.raw)
    expect(intent.kind).toBe('examine')
    expect(intent.targetPlaceId).toBe(board.id)

    sim.postExternalIntent('agent-0', intent, meta(intent.reason))
    let examined = false
    for (let i = 0; i < 120; i++) {
      sim.advanceTicks(1)
      if (sim.getEvents().some((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0')) {
        examined = true
        break
      }
    }
    expect(examined).toBe(true)
    const ev = sim.getEvents().find((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0')!
    expect(ev.data?.target).toBe(board.id)
    expect(String(ev.data?.knowledge)).toMatch(/propose/i)
    const known = knowledgeLinesForPrompt('agent-0', sim.getEvents(), sim.state.mindNoteLog)
    expect(known.some((l) => /propose/i.test(l))).toBe(true)
    const mem = episodicMemories('agent-0', sim.getEvents())
    expect(mem.some((m) => m.text.includes('examined the notice board'))).toBe(true)
  })
})

describe('discovery layer — novelty', () => {
  it('discovery:noticed fires once per kind per agent', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(30)
    const byAgentKind = new Map<string, number>()
    for (const e of sim.getEvents()) {
      if (e.type !== 'discovery:noticed' || !e.agentId) continue
      const kind = String(e.data?.kind ?? '')
      const key = `${e.agentId}:${kind}`
      byAgentKind.set(key, (byAgentKind.get(key) ?? 0) + 1)
    }
    expect(byAgentKind.size).toBeGreaterThan(0)
    for (const [key, n] of byAgentKind) {
      expect(n, key).toBe(1)
    }
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain('(unfamiliar)')
  })
})

describe('discovery layer — ground sleep', () => {
  it('ground sleep restores at 60% of the bed rate', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(80)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.needs.energy = 0.2
    const jitter = agent.needJitter.energy
    sim.postExternalIntent(
      'agent-0',
      { kind: 'sleep', reason: 'I will rest right here.' },
      meta('I will rest right here.'),
    )
    sim.advanceTicks(1)
    expect(agent.action.kind).toBe('sleep')
    expect(agent.action.targetPlaceId).toBeUndefined()
    const start = agent.needs.energy
    sim.advanceTicks(100)
    expect(agent.action.kind).toBe('sleep')
    const expected = clamp01(start + 100 * SLEEP_GROUND_ENERGY * jitter)
    expect(agent.needs.energy).toBeCloseTo(expected, 5)
    expect(agent.needs.energy).toBeLessThan(start + 100 * SLEEP_BED_ENERGY * jitter - 0.01)
  })

  it('bed sleep uses the full rate and a bed felt line', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(80)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const home = sim.state.places.find((p) => p.id === agent.homeId)!
    agent.needs.energy = 0.2
    const jitter = agent.needJitter.energy
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'sleep',
        targetPlaceId: home.id,
        targetX: home.x,
        targetY: home.y,
        reason: 'I will sleep in my bed.',
      },
      meta('I will sleep in my bed.'),
    )
    // Walk home if needed, then sample 40 ticks of performing sleep
    for (let i = 0; i < 80; i++) {
      sim.advanceTicks(1)
      if (
        agent.action.kind === 'sleep' &&
        agent.action.targetPlaceId === home.id &&
        !agent.action.path?.length
      ) {
        break
      }
    }
    const start = agent.needs.energy
    sim.advanceTicks(40)
    const expected = clamp01(start + 40 * SLEEP_BED_ENERGY * jitter)
    expect(agent.needs.energy).toBeCloseTo(expected, 4)
  })
})

describe('discovery layer — prompts + persist', () => {
  it('system prompt extracted: no institution mechanics or market prices; stance present', () => {
    const sys = buildSystemPrompt('agent-0')
    expect(sys).toMatch(
      /You feel your needs\. The world contains places and things whose workings you learn by living, examining, and listening\./,
    )
    expect(sys).not.toMatch(/anyone may/i)
    expect(sys).not.toMatch(/2 coins/)
    expect(sys).not.toMatch(/15 coins/)
    expect(sys).not.toMatch(/1 coin/)
    expect(sys).not.toMatch(/may be followed or broken/i)
    expect(sys).not.toMatch(/market price/i)
    expect(sys).not.toMatch(/food price/i)
    expect(sys).not.toMatch(/clamp\(round/)
    expect(sys).toContain('examine')
    expect(sys).toContain('propose')
  })

  it('user prompt has Known + Recently felt; no market price line', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain('Known:')
    expect(user).toContain('Recently felt:')
    expect(user).toContain('Your memories:')
    expect(user).not.toMatch(/Market: food price/)
  })

  it('save round-trips learned notes and examine events', () => {
    const sim = new Simulation(11)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'examine',
        targetPlaceId: board.id,
        targetX: board.x,
        targetY: board.y,
        reason: 'look',
      },
      meta('look'),
    )
    for (let i = 0; i < 100; i++) {
      sim.advanceTicks(1)
      if (sim.getEvents().some((e) => e.type === 'discovery:examined')) break
    }
    sim.postMindNotes(
      'agent-0',
      ['I learned something today.'],
      { provider: 'mock', latencyMs: 1 },
      ['The board is where people post rules.'],
    )
    sim.advanceTicks(1)
    const save = serializeSave(sim)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(sim.hash())
    const rec = restored.state.mindNoteLog.find((r) => r.agentId === 'agent-0')
    expect(rec?.learned).toEqual(['The board is where people post rules.'])
    expect(
      restored.getEvents().some((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0'),
    ).toBe(true)
    const knownA = knowledgeLinesForPrompt('agent-0', sim.getEvents(), sim.state.mindNoteLog)
    const knownB = knowledgeLinesForPrompt(
      'agent-0',
      restored.getEvents(),
      restored.state.mindNoteLog,
    )
    expect(knownB).toEqual(knownA)
  })

  it('determinism double-run matches with discovery events', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(400)
    b.advanceTicks(400)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    const na = a.getEvents().filter((e) => e.type === 'discovery:noticed').length
    const nb = b.getEvents().filter((e) => e.type === 'discovery:noticed').length
    expect(na).toBe(nb)
    expect(na).toBeGreaterThan(0)
  })

  it('reflection parse accepts learned field', () => {
    const ok = parseReflectionJson(
      JSON.stringify({
        notes: ['I worked and ate.'],
        learned: ['Eating filled me.', 'The well woke me a little.'],
      }),
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.notes).toHaveLength(1)
      expect(ok.learned).toHaveLength(2)
    }
    const missing = parseReflectionJson(JSON.stringify({ notes: ['Just notes.'] }))
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.learned).toEqual([])
  })
})

describe('discovery layer — intents', () => {
  it('examine is a valid mind action', () => {
    const parsed = parseMindJson(
      JSON.stringify({ action: 'examine', target: 'board', reasoning: 'Curious about the post.' }),
    )
    expect(parsed.ok).toBe(true)
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    if (parsed.ok) {
      const intent: Intent = resolveMindIntent(sim.state, mira, parsed.raw)
      expect(intent.kind).toBe('examine')
      expect(intent.targetPlaceId).toBe('notice-board-0')
    }
  })
})
