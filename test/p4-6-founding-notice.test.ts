import { describe, expect, it } from 'vitest'
import { PROPOSAL_WINDOW_TICKS, Simulation, isSheepAgent } from '../src/sim/sim'
import { EXAMINE_BY_KIND } from '../src/sim/examine'
import { knowledgeLinesForPrompt } from '../src/mind/knowledge'
import { buildUserPrompt } from '../src/mind/prompt'
import { SAVE_FORMAT_VERSION } from '../src/sim/persist'
import { findNoticeBoardSpot } from '../src/sim/worldgen'

const FOUNDING_TEXT = 'Share food with anyone you find collapsed, if you can spare it.'
const FOUNDING_ID = 'prop-founding-0'
const FOUNDING_BOARD = 'notice-board-founding'

function boardsOf(sim: Simulation) {
  return sim.state.places.filter((p) => p.kind === 'notice-board')
}

describe('P4-6 founding notice', () => {
  it('save format version is unchanged', () => {
    expect(SAVE_FORMAT_VERSION).toBe(5)
  })

  it('seedFoundingBoard omitted or false is a no-op on wild (regression pin)', () => {
    const bare = new Simulation(42, { preset: 'wild' })
    const flagged = new Simulation(42, { preset: 'wild', seedFoundingBoard: false })
    expect(flagged.hash()).toBe(bare.hash())
    expect(flagged.getEventCount()).toBe(bare.getEventCount())
    expect(flagged.state.proposals).toHaveLength(0)
    expect(boardsOf(flagged)).toHaveLength(0)
    expect(
      bare.state.places.every(
        (p) => p.kind === 'plaza' || p.kind === 'berry-bush' || p.kind === 'spring',
      ),
    ).toBe(true)
  })

  it('findNoticeBoardSpot extraction keeps default/lean board placement', () => {
    const def = new Simulation(42)
    const lean = new Simulation(42, { preset: 'lean' })
    const defBoard = def.state.places.find((p) => p.id === 'notice-board-0')!
    const leanBoard = lean.state.places.find((p) => p.id === 'notice-board-0')!
    expect(defBoard).toBeTruthy()
    expect(leanBoard).toBeTruthy()
    expect(defBoard.x).toBe(leanBoard.x)
    expect(defBoard.y).toBe(leanBoard.y)

    const plaza = def.state.places.find((p) => p.kind === 'plaza')!
    const well = def.state.places.find((p) => p.kind === 'well')!
    const taken = new Set([`${plaza.x},${plaza.y}`, `${well.x},${well.y}`])
    expect(findNoticeBoardSpot(def.state.tiles, plaza.x, plaza.y, taken)).toEqual({
      x: defBoard.x,
      y: defBoard.y,
    })

    expect(new Simulation(42, { seedFoundingBoard: false }).hash()).toBe(def.hash())
    expect(new Simulation(42, { preset: 'lean', seedFoundingBoard: false }).hash()).toBe(
      lean.hash(),
    )
  })

  it('seedFoundingBoard true on wild places one board, one founding proposal, and mind knowledge', () => {
    const sim = new Simulation(42, { preset: 'wild', seedFoundingBoard: true })
    const boards = boardsOf(sim)
    expect(boards).toHaveLength(1)
    const board = boards[0]!
    expect(board.id).toBe(FOUNDING_BOARD)
    expect(sim.state.owners[board.id]).toBe('commons')
    expect(sim.state.proposals).toHaveLength(1)
    expect(sim.state.proposals[0]).toEqual({
      id: FOUNDING_ID,
      proposerId: 'anonymous',
      text: FOUNDING_TEXT,
      createdTick: 0,
      closesTick: PROPOSAL_WINDOW_TICKS,
      votes: {},
      status: 'open',
    })

    const proposed = sim.getEvents().filter((e) => e.type === 'institution:proposed')
    expect(proposed).toHaveLength(1)
    expect(proposed[0]!.agentId).toBeUndefined()
    expect(proposed[0]!.data).toMatchObject({
      proposalId: FOUNDING_ID,
      text: FOUNDING_TEXT,
      proposerId: 'anonymous',
      agentName: 'the founders',
      closesTick: PROPOSAL_WINDOW_TICKS,
      firstProposal: true,
    })
    expect(proposed[0]!.reason).toBe(`A founding notice was posted: "${FOUNDING_TEXT}"`)

    const minds = sim.state.agents.filter((a) => !isSheepAgent(a.id))
    expect(minds.length).toBe(6)
    const examined = sim.getEvents().filter((e) => e.type === 'discovery:examined')
    expect(examined).toHaveLength(minds.length)
    for (const agent of minds) {
      const ev = examined.find((e) => e.agentId === agent.id)
      expect(ev, agent.id).toBeTruthy()
      expect(ev!.data).toMatchObject({
        target: board.id,
        placeKind: 'notice-board',
        knowledge: EXAMINE_BY_KIND['notice-board'],
        agentName: agent.name,
      })
      expect(ev!.reason).toBe(`${agent.name} already knows the board's uses`)
      const known = knowledgeLinesForPrompt(agent.id, sim.getEvents(), sim.state.mindNoteLog)
      expect(known).toContain(EXAMINE_BY_KIND['notice-board'])
    }
    expect(examined.filter((e) => e.agentId && isSheepAgent(e.agentId))).toHaveLength(0)

    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const user = buildUserPrompt(mira, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain(EXAMINE_BY_KIND['notice-board'])
    expect(user).toContain(FOUNDING_ID)
    expect(user).toContain(FOUNDING_TEXT)
  })

  it('seedFoundingBoard true with restored state is a no-op', () => {
    const bare = new Simulation(42, { preset: 'wild' })
    const hash = bare.hash()
    const events = bare.getEventCount()
    const resumed = new Simulation(42, {
      state: bare.state,
      seedFoundingBoard: true,
    })
    expect(resumed.state.proposals).toHaveLength(0)
    expect(boardsOf(resumed)).toHaveLength(0)
    expect(resumed.getEvents().some((e) => e.type === 'institution:proposed')).toBe(false)
    expect(resumed.getEvents().some((e) => e.type === 'discovery:examined')).toBe(false)
    expect(bare.hash()).toBe(hash)
    expect(bare.getEventCount()).toBe(events)
    expect(resumed.hash()).toBe(hash)
  })

  it('seedFoundingBoard true on default/lean reuses the existing board and seeds one proposal', () => {
    for (const preset of ['default', 'lean'] as const) {
      const unseeded = new Simulation(42, preset === 'default' ? undefined : { preset })
      const seeded = new Simulation(42, {
        ...(preset === 'default' ? {} : { preset }),
        seedFoundingBoard: true,
      })
      const boards = boardsOf(seeded)
      expect(boards, preset).toHaveLength(1)
      expect(boards[0]!.id).toBe('notice-board-0')
      const orig = unseeded.state.places.find((p) => p.id === 'notice-board-0')!
      expect(boards[0]!.x).toBe(orig.x)
      expect(boards[0]!.y).toBe(orig.y)
      expect(seeded.state.owners['notice-board-0']).toBe('commons')
      expect(seeded.state.proposals).toHaveLength(1)
      expect(seeded.state.proposals[0]!.id).toBe(FOUNDING_ID)
      expect(seeded.getEvents().filter((e) => e.type === 'institution:proposed')).toHaveLength(1)
      const examined = seeded.getEvents().filter((e) => e.type === 'discovery:examined')
      const minds = seeded.state.agents.filter((a) => !isSheepAgent(a.id))
      expect(examined).toHaveLength(minds.length)
      expect(examined.every((e) => e.data?.target === 'notice-board-0')).toBe(true)
    }
  })

  it('seeded wild path is deterministic across two fresh runs of 1 sim-day', () => {
    const a = new Simulation(42, { preset: 'wild', seedFoundingBoard: true })
    const b = new Simulation(42, { preset: 'wild', seedFoundingBoard: true })
    expect(a.hash()).toBe(b.hash())
    a.advanceTicks(1440)
    b.advanceTicks(1440)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    expect(a.stateAt(1440).hash()).toBe(a.hash())
    expect(a.stateAt(0).state.proposals).toHaveLength(1)
    expect(a.stateAt(0).state.places.filter((p) => p.kind === 'notice-board')).toHaveLength(1)
  })
})
