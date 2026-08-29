import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { firstStormObjectives, secureFood } from '../sim/firstStorm'
import { BUILD_RECIPES, MAX_PLACE_LEVEL, placeLevel } from '../sim/sim'
import type {
  BuildableKind,
  Good,
  SimEvent,
  WorkPriorityCategory,
  WorkPriorityLevel,
  WorldState,
} from '../sim/types'
import { DEFAULT_WORK_PRIORITIES, workCategoryForPlace } from '../sim/workPriorities'
import {
  appealComponents,
  availableInvitation,
  buildUnlockLabel,
  currentMilestone,
  isBuildUnlocked,
  nextMilestone,
  townAppeal,
  upgradesUnlocked,
} from '../sim/townGrowth'
import type { TownSpeed } from './constants'
import type { TownState } from './debug'
import type { TownInteractionState } from './placementController'
import {
  residentHomeLabel,
  residentWorkLabel,
  strongestRelationship,
  townAlerts,
  townStories,
  townVitals,
} from './legibility'
import type { TownOverlayMode } from './worldOverlays'
import { personaFor } from '../mind/personas'
import type { MindMeter } from '../mind/lunaBrain'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const
function seasonFor(day: number, world: WorldState): string {
  if (world.scenario?.kind === 'first-storm') return 'First season'
  const idx = Math.floor(Math.max(0, day - 1) / 22) % SEASONS.length
  return SEASONS[idx]!
}

const SPEEDS: Array<{ n: TownSpeed; label: string }> = [
  { n: 0, label: 'Pause' },
  { n: 1, label: '1×' },
  { n: 2, label: '2×' },
  { n: 4, label: '4×' },
]

const OVERLAY_BUTTONS: Array<{ mode: TownOverlayMode; label: string }> = [
  { mode: 'none', label: 'Off' },
  { mode: 'needs', label: 'Needs' },
  { mode: 'housing', label: 'Homes' },
  { mode: 'jobs', label: 'Jobs' },
  { mode: 'resources', label: 'Goods' },
  { mode: 'fertility', label: 'Soil' },
  { mode: 'water', label: 'Water' },
  { mode: 'ownership', label: 'Owners' },
  { mode: 'paths', label: 'Routes' },
]

const BUILD_MENU: Array<{ kind: BuildableKind; label: string; glyph: string }> = [
  { kind: 'farm', label: 'Farm', glyph: 'F' },
  { kind: 'forestry', label: 'Forestry camp', glyph: 'W' },
  { kind: 'quarry', label: 'Quarry', glyph: 'Q' },
  { kind: 'home', label: 'House', glyph: '⌂' },
  { kind: 'well', label: 'Well', glyph: '◉' },
  { kind: 'stall', label: 'Market stall', glyph: '▤' },
  { kind: 'storehouse', label: 'Storehouse', glyph: '▰' },
  { kind: 'notice-board', label: 'Notice board', glyph: '⚑' },
]

const WORK_ROWS: Array<{ category: WorkPriorityCategory; label: string; purpose: string }> = [
  { category: 'food', label: 'Food', purpose: 'Farm and market' },
  { category: 'build', label: 'Building', purpose: 'Construction crews' },
  { category: 'wood', label: 'Wood', purpose: 'Forestry camps' },
  { category: 'stone', label: 'Stone', purpose: 'Quarries' },
]

const DEMOLISHABLE = new Set<BuildableKind>([
  'home',
  'farm',
  'well',
  'stall',
  'storehouse',
  'forestry',
  'quarry',
  'notice-board',
])

interface ResourceState {
  treasury: number
  food: number
  wood: number
  stone: number
}

interface EconomyDirectionView {
  priorities: Record<WorkPriorityCategory, WorkPriorityLevel>
  assigned: Record<WorkPriorityCategory, number>
  unassigned: number
}

function economyDirectionFromWorld(world: WorldState): EconomyDirectionView {
  const assigned: Record<WorkPriorityCategory, number> = {
    food: 0,
    build: 0,
    wood: 0,
    stone: 0,
  }
  let unassigned = 0
  for (const agent of world.agents) {
    if (!agent.employedAt) {
      unassigned += 1
      continue
    }
    const workplace = world.places.find((place) => place.id === agent.employedAt)
    const category = workplace ? workCategoryForPlace(workplace) : null
    if (category) assigned[category] += 1
  }
  return {
    priorities: { ...DEFAULT_WORK_PRIORITIES, ...(world.workPriorities ?? {}) },
    assigned,
    unassigned,
  }
}

interface ScenarioView {
  status: 'preparing' | 'storm' | 'survived' | 'failed'
  countdown: string
  countdownLabel: string
  objectives: ReturnType<typeof firstStormObjectives>
  population: number
  housed: number
  departed: number
}

function formatCountdown(ticks: number): string {
  const remaining = Math.max(0, Math.ceil(ticks))
  const days = Math.floor(remaining / 1440)
  const hours = Math.floor((remaining % 1440) / 60)
  const minutes = remaining % 60
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h ${pad2(minutes)}m`
}

function scenarioFromWorld(world: WorldState): ScenarioView | null {
  const scenario = world.scenario
  if (!scenario || scenario.kind !== 'first-storm') return null
  const housing = world.places
    .filter((place) => place.kind === 'home')
    .reduce((sum, place) => sum + place.slots, 0)
  const targetTick = scenario.status === 'preparing'
    ? scenario.stormStartTick
    : scenario.status === 'storm'
      ? scenario.stormEndTick
      : world.tick
  return {
    status: scenario.status,
    countdown: formatCountdown(targetTick - world.tick),
    countdownLabel: scenario.status === 'preparing'
      ? 'Storm arrives in'
      : scenario.status === 'storm'
        ? 'Storm clears in'
        : scenario.status === 'survived'
          ? 'First storm survived'
          : 'Promises broken',
    objectives: firstStormObjectives(world),
    population: world.agents.length,
    housed: Math.min(housing, world.agents.length),
    departed: scenario.departedAgentIds.length,
  }
}

function resourcesFromWorld(world: WorldState): ResourceState {
  let wood = 0
  let stone = 0
  for (const p of world.places) {
    if (p.kind === 'storehouse') {
      wood += p.inventory.wood ?? 0
      stone += p.inventory.stone ?? 0
    }
  }
  return {
    treasury: Math.floor(world.treasury),
    food: secureFood(world),
    wood: Math.floor(wood),
    stone: Math.floor(stone),
  }
}

function growthFromWorld(world: WorldState) {
  return {
    appeal: townAppeal(world),
    components: appealComponents(world),
    milestone: currentMilestone(world),
    next: nextMilestone(world),
    invitation: availableInvitation(world),
  }
}

export function Hud(props: {
  getState: () => TownState
  getWorld: () => WorldState
  getEvents: () => readonly SimEvent[]
  getInteraction: () => TownInteractionState
  setSpeed: (n: TownSpeed) => void
  beginBuild: (kind: BuildableKind) => void
  beginPath: () => void
  cancelPlacement: () => void
  cancelSelected: () => void
  demolishSelected: () => void
  setWorkPriority: (category: WorkPriorityCategory, level: WorkPriorityLevel) => void
  setConstructionPriority: (placeId: string, priority: 1 | 2 | 3) => void
  setStockpileFilter: (placeId: string, good: Good, enabled: boolean) => void
  upgradePlace: (placeId: string) => void
  acceptInvitation: (candidateId: string) => void
  selectAgent: (agentId: string | null) => void
  selectPlace: (placeId: string | null) => void
  setOverlay: (mode: TownOverlayMode) => void
  getMindMeter: () => MindMeter | null
  screenForAgent: (agentId: string) => { x: number; y: number } | null
  replayLatestMindMoment: () => { tick: number; label: string; reason: string; callsUnchanged: boolean } | null
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const [boardOpen, setBoardOpen] = useState(false)
  const [growthOpen, setGrowthOpen] = useState(false)
  const [chronicleOpen, setChronicleOpen] = useState(false)
  const [replayProof, setReplayProof] = useState<{ tick: number; label: string; reason: string; callsUnchanged: boolean } | null>(null)
  const [overlayMode, setOverlayMode] = useState<TownOverlayMode>('none')
  const [view, setView] = useState(() => {
    const world = props.getWorld()
    const town = props.getState()
    return {
      town,
      interaction: props.getInteraction(),
      resources: resourcesFromWorld(world),
      economy: economyDirectionFromWorld(world),
      scenario: scenarioFromWorld(world),
      season: seasonFor(town.day, world),
      vitals: townVitals(world),
      alerts: townAlerts(world),
      stories: townStories(world, props.getEvents()),
      growth: growthFromWorld(world),
      mind: props.getMindMeter(),
    }
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = props.getState()
      const world = props.getWorld()
      setView({
        town: {
          ...next,
          assets: { ...next.assets },
          camera: { ...next.camera },
        },
        interaction: props.getInteraction(),
        resources: resourcesFromWorld(world),
        economy: economyDirectionFromWorld(world),
        scenario: scenarioFromWorld(world),
        season: seasonFor(next.day, world),
        vitals: townVitals(world),
        alerts: townAlerts(world),
        stories: townStories(world, props.getEvents()),
        growth: growthFromWorld(world),
        mind: props.getMindMeter(),
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [props])

  const { town, interaction, resources, economy, scenario, season, vitals, alerts, stories, growth, mind } = view
  const selected = interaction.selectedPlace
  const currentWorld = props.getWorld()
  const selectedUpgradeTarget = selected?.construction?.upgradeOf
    ? currentWorld.places.find((place) => place.id === selected.construction?.upgradeOf)
    : undefined
  const selectedAgent = interaction.selectedAgent
  const selectedLabel = selected
    ? selected.kind === 'construction-site'
      ? selectedUpgradeTarget
        ? `${selected.construction?.targetKind === 'home' ? 'House' : selected.construction?.targetKind ?? 'Building'} upgrade to level ${placeLevel(selectedUpgradeTarget) + 1}`
        : `${selected.construction?.targetKind === 'home' ? 'House' : selected.construction?.targetKind ?? 'Building'} site`
      : selected.kind === 'home'
        ? 'House'
        : selected.kind.replace(/-/g, ' ')
    : ''
  const constructionProgress = selected?.construction?.progress ?? 0
  const selectedRelationship = selectedAgent
    ? strongestRelationship(selectedAgent, currentWorld)
    : null
  const selectedMindDecision = selectedAgent
    ? [...currentWorld.externalIntentLog]
        .reverse()
        .find((record) => record.agentId === selectedAgent.id)
    : undefined
  const openProposals = currentWorld.proposals.filter((proposal) => proposal.status === 'open')
  const standingRules = currentWorld.rules.filter((rule) => rule.active)
  const currentGatherings = currentWorld.gatherings ?? []
  const recentAssemblyEvent = [...props.getEvents()].reverse().find((event) => event.type === 'gathering:scheduled' || event.type === 'gathering:started' || event.type === 'gathering:ended')
  const recentSays = [...currentWorld.sayLog]
    .reverse()
    .filter((say, index, rows) => say.tick >= currentWorld.tick - 1_440 && rows.findIndex((row) => row.agentId === say.agentId) === index)
    .slice(0, 3)
  const selectedWorkers = selected
    ? currentWorld.agents.filter((agent) => agent.employedAt === selected.id).length
    : 0
  const selectedCapacity = selected?.jobSlots ?? 0
  const selectedRecipe = selected?.kind === 'construction-site'
    ? BUILD_RECIPES[selected.construction?.targetKind ?? 'home']
    : null
  const shortMaterials = selected?.kind === 'construction-site'
    ? (['wood', 'stone'] as const).filter(
        (good) =>
          (selected.construction?.needs[good] ?? 0) > (selected.inventory[good] ?? 0),
      )
    : []
  const selectedStatus = !selected
    ? ''
    : selected.kind === 'construction-site'
      ? selectedWorkers === 0
        ? 'Stalled: no builders assigned'
        : shortMaterials.length > 0
          ? `Waiting for ${shortMaterials.join(' and ')} delivery`
          : 'Builders have materials and are working'
      : selected.production
        ? selectedWorkers === 0
          ? 'Stalled: no workers assigned'
          : 'Producing while workers tend this site'
        : selected.kind === 'storehouse'
          ? 'Haulers use enabled intake categories'
          : ''

  return (
    <div style={hudRoot}>
      {scenario?.status === 'storm' ? (
        <div style={stormOverlay} data-testid="storm-overlay" aria-hidden="true" />
      ) : null}
      <header style={topBar}>
        <span style={clock} data-testid="town-clock">
          Day {town.day} · {season} · {pad2(town.hour)}:{pad2(town.minute)}
        </span>
        <span style={resourceGroup} data-testid="town-resources">
          <Resource glyph="P" label="Settlers" value={scenario?.population ?? town.agentCount} />
          <Resource glyph="◈" label="Treasury" value={resources.treasury} />
          <Resource glyph="●" label="Food" value={resources.food} />
          <Resource glyph="▥" label="Wood" value={resources.wood} />
          <Resource glyph="◆" label="Stone" value={resources.stone} />
          <Resource glyph="☆" label="Appeal" value={growth.appeal} />
          {mind?.enabled ? (
            <span style={mindChip} data-testid="town-mind-budget" title="Hard session token ceiling">
              Mind {mind.provider} · {mind.decisions} · {mind.sessionTokensUsed}/{mind.sessionTokenBudget} tokens
            </span>
          ) : null}
        </span>
        <span style={speedGroup}>
          {SPEEDS.map((b) => (
            <button
              key={b.n}
              type="button"
              data-testid={`speed-${b.n}`}
              onClick={() => props.setSpeed(b.n)}
              style={town.speed === b.n ? speedButtonOn : speedButton}
            >
              {b.label}
            </button>
          ))}
        </span>
      </header>

      {scenario ? (
        <aside style={scenarioPanel} data-testid="first-storm-panel" data-status={scenario.status}>
          <div style={scenarioEyebrow}>First season challenge</div>
          <div style={scenarioHeader}>
            <div>
              <h1 style={scenarioTitle}>Shelter the settlement</h1>
              <div style={scenarioPopulation} data-testid="scenario-population">
                {scenario.population} settlers · {scenario.housed} housed
              </div>
            </div>
            <div style={{ ...countdownBadge, ...countdownTone(scenario.status) }} data-testid="storm-countdown">
              <span style={countdownLabel}>{scenario.countdownLabel}</span>
              {(scenario.status === 'preparing' || scenario.status === 'storm') ? (
                <strong style={countdownValue}>{scenario.countdown}</strong>
              ) : null}
            </div>
          </div>
          <div style={objectiveList} data-testid="storm-objectives">
            {scenario.objectives.map((objective) => (
              <div key={objective.id} style={objectiveRow} data-testid={`objective-${objective.id}`} data-met={objective.met}>
                <span style={objective.met ? objectiveMarkMet : objectiveMark}>{objective.met ? 'DONE' : 'NEED'}</span>
                <span style={objectiveCopy}>
                  <strong>{objective.label}</strong>
                  <span>{objective.current} / {objective.target}</span>
                </span>
                <span style={objectiveTrack}>
                  <span style={{ ...objectiveFill, width: `${Math.min(100, objective.current / Math.max(1, objective.target) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
          {scenario.status === 'preparing' ? (
            <p style={scenarioHint}>Before landfall: build one house and one well, with at least 14 food stored.</p>
          ) : scenario.status === 'storm' ? (
            <p style={stormWarning}>Storm pressure: hunger doubles, fatigue rises, shore water and natural regrowth stop.</p>
          ) : scenario.status === 'survived' ? (
            <p style={successNotice}>The settlement held. Every settler stayed.</p>
          ) : (
            <p style={failureNotice}>{scenario.departed} settler{scenario.departed === 1 ? '' : 's'} left after the storm.</p>
          )}
        </aside>
      ) : null}

      <aside style={growthOpen ? townPulsePanelGrowth : townPulsePanel} data-testid="town-pulse">
        <div style={pulseHeader}>
          <div>
            <div style={eyebrow}>Town pulse</div>
            <strong>{vitals.housed}/{vitals.population} housed · {vitals.foodDays.toFixed(1)} food days</strong>
          </div>
          <span style={pulseActions}>
            <button
              type="button"
              data-testid="town-growth-toggle"
              aria-pressed={growthOpen}
              onClick={() => {
                setGrowthOpen((open) => !open)
                setBoardOpen(false)
                setChronicleOpen(false)
              }}
              style={growthOpen ? compactButtonOn : compactButton}
            >
              Growth
            </button>
            <button
              type="button"
              data-testid="town-board-toggle"
              aria-pressed={boardOpen}
              onClick={() => {
                setBoardOpen((open) => !open)
                setGrowthOpen(false)
                setChronicleOpen(false)
              }}
              style={boardOpen ? compactButtonOn : compactButton}
            >
              Board
            </button>
            <button
              type="button"
              data-testid="town-chronicle-toggle"
              aria-pressed={chronicleOpen}
              onClick={() => {
                setChronicleOpen((open) => !open)
                setGrowthOpen(false)
                setBoardOpen(false)
              }}
              style={chronicleOpen ? compactButtonOn : compactButton}
            >Chronicle</button>
          </span>
        </div>

        <div style={overlayBar} data-testid="town-overlays">
          <span style={overlayLabel}>Overlay</span>
          {OVERLAY_BUTTONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              data-testid={`overlay-${mode}`}
              aria-pressed={overlayMode === mode}
              onClick={() => {
                setOverlayMode(mode)
                props.setOverlay(mode)
              }}
              style={overlayMode === mode ? compactButtonOn : compactButton}
            >
              {label}
            </button>
          ))}
        </div>

        {growthOpen ? (
          <div style={pulseScrollGrowth} data-testid="town-growth-panel">
            <div style={growthLead}>
              <strong>{growth.appeal} / 100 Appeal</strong>
              <span>{growth.milestone.label}</span>
            </div>
            <div style={appealTrack}><span style={{ ...appealFill, width: `${growth.appeal}%` }} /></div>
            <div style={growthComponents} data-testid="appeal-breakdown">
              {growth.components.map((component) => (
                <div key={component.id} style={growthComponent} title={component.detail}>
                  <span>{component.label}</span><strong>{component.score}/{component.max}</strong>
                </div>
              ))}
            </div>
            {growth.next ? (
              <div style={growthNext} data-testid="next-milestone">
                Next: {growth.next.label} at {growth.next.threshold} - {growth.next.unlock}
              </div>
            ) : <div style={growthNext}>All town milestones reached.</div>}
            {growth.invitation ? (
              <div data-testid="invitation-offer">
                <div style={pulseSubheading}>Choose one Luna resident</div>
                {growth.invitation.candidates.map((candidate) => (
                  <div key={candidate.id} style={candidateCard} data-testid={`invitation-${candidate.id}`}>
                    <span style={candidateCopy}><strong>{candidate.name}</strong><small>{candidate.promise}</small><small>Wants: {candidate.preferredWork}</small></span>
                    <button
                      type="button"
                      style={inviteButton}
                      onClick={() => {
                        props.acceptInvitation(candidate.id)
                        setGrowthOpen(false)
                      }}
                    >Invite</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={growthNext} data-testid="invitation-status">
                {currentWorld.scenario?.kind === 'first-storm' && currentWorld.scenario.status !== 'survived'
                  ? 'Invitations open after the first storm is survived.'
                  : 'Raise Appeal and keep one bed open for the next invitation.'}
              </div>
            )}
          </div>
        ) : boardOpen ? (
          <div style={pulseScroll} data-testid="town-board">
            <div style={pulseSubheading}>Open proposals</div>
            {openProposals.length > 0 ? openProposals.slice(0, 3).map((proposal) => {
              const proposer = currentWorld.agents.find((agent) => agent.id === proposal.proposerId)
              const yes = Object.values(proposal.votes).filter((vote) => vote === 'yes').length
              const no = Object.values(proposal.votes).filter((vote) => vote === 'no').length
              return (
                <button
                  key={proposal.id}
                  type="button"
                  data-testid="town-board-proposal"
                  onClick={() => props.selectAgent(proposal.proposerId)}
                  style={storyRow}
                >
                  <strong>{proposal.text}</strong>
                  <span>{proposer?.name ?? proposal.proposerId} · yes {yes} / no {no}</span>
                </button>
              )
            }) : <div style={emptyPulse}>No proposals posted yet.</div>}
            <div style={pulseSubheading}>Standing rules</div>
            {standingRules.length > 0 ? standingRules.slice(0, 3).map((rule) => (
              <div key={rule.id} data-testid="town-board-rule" style={ruleRow}>{rule.text}</div>
            )) : <div style={emptyPulse}>No standing rules yet.</div>}
            <div style={pulseSubheading}>Assemblies</div>
            {currentGatherings.length > 0 ? currentGatherings.slice(0, 2).map((gathering) => {
              const venue = currentWorld.places.find((place) => place.id === gathering.placeId)
              return <div key={gathering.id} data-testid="town-board-gathering" style={ruleRow}>
                Assembly at the {venue?.kind === 'notice-board' ? 'notice board' : 'plaza'} · {gathering.attended?.length ?? 0} attended
              </div>
            }) : recentAssemblyEvent ? <div data-testid="town-board-gathering" style={ruleRow}>{recentAssemblyEvent.reason}</div> : <div style={emptyPulse}>No assembly scheduled.</div>}
          </div>
        ) : chronicleOpen ? (
          <div style={pulseScroll} data-testid="town-chronicle">
            <div style={pulseSubheading}>Recorded mind moments</div>
            {[...currentWorld.externalIntentLog].slice(-3).reverse().map((record) => {
              const resident = currentWorld.agents.find((agent) => agent.id === record.agentId)
              return <div key={`${record.tick}-${record.agentId}`} style={ruleRow}>{resident?.name ?? record.agentId}: {record.meta.reasoning}</div>
            })}
            <div style={pulseSubheading}>Conversations</div>
            {[...currentWorld.sayLog].slice(-3).reverse().map((say) => {
              const resident = currentWorld.agents.find((agent) => agent.id === say.agentId)
              return <div key={`${say.conversationId}-${say.turn}`} style={ruleRow}>{resident?.name ?? say.agentId}: “{say.text}”</div>
            })}
            <button type="button" data-testid="replay-latest-mind" style={inviteButton} onClick={() => setReplayProof(props.replayLatestMindMoment())}>Revisit latest mind moment</button>
            {replayProof ? <div style={replayProof.callsUnchanged ? replayPass : stallLine} data-testid="town-replay-proof">
              {replayProof.label}: {replayProof.reason}<br />{replayProof.callsUnchanged ? 'Replayed from the town record · zero new mind calls' : 'Replay requested a new mind call'}
            </div> : null}
          </div>
        ) : (
          <div style={pulseColumns}>
            <div>
              <div style={pulseSubheading}>Actionable</div>
              {alerts.slice(0, 3).map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  data-testid="town-alert"
                  data-severity={alert.severity}
                  onClick={() => {
                    if (alert.agentId) props.selectAgent(alert.agentId)
                    else if (alert.placeId) props.selectPlace(alert.placeId)
                  }}
                  style={{ ...alertRow, borderLeftColor: alertColor(alert.severity) }}
                >
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </button>
              ))}
            </div>
            <div>
              <div style={pulseSubheading}>Town stories</div>
              {stories.slice(0, 3).map((story) => (
                <button
                  key={story.id}
                  type="button"
                  data-testid="town-story"
                  onClick={() => story.agentId && props.selectAgent(story.agentId)}
                  style={storyRow}
                >
                  {story.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <div style={bottomLeft}>
        {menuOpen ? (
          <section style={buildPanel} data-testid="build-menu">
            <div style={panelHeading}>
              <span>Construction</span>
              <span style={panelHint}>Designate a site. Villagers deliver and build.</span>
            </div>
            <div style={buildGrid}>
              {BUILD_MENU.map((item) => {
                const recipe = BUILD_RECIPES[item.kind]
                const active = interaction.activeKind === item.kind
                const unlocked = isBuildUnlocked(currentWorld, item.kind)
                const unlockLabel = buildUnlockLabel(item.kind)
                return (
                  <button
                    key={item.kind}
                    type="button"
                    data-testid={`build-${item.kind}`}
                    aria-pressed={active}
                    aria-disabled={!unlocked}
                    disabled={!unlocked}
                    title={!unlocked ? `Unlock at ${unlockLabel}` : undefined}
                    onClick={() => props.beginBuild(item.kind)}
                    style={!unlocked ? buildCardLocked : active ? buildCardActive : buildCard}
                  >
                    <span style={buildGlyph}>{item.glyph}</span>
                    <span style={buildName}>{item.label}</span>
                    <span style={buildCost}>{unlocked ? `${recipe.wood} wood · ${recipe.stone} stone` : `Locked: ${unlockLabel}`}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}
        {prioritiesOpen ? (
          <section style={priorityPanel} data-testid="work-priorities-panel">
            <div style={panelHeading}>
              <span>Town work priorities</span>
              <span style={panelHint}>{economy.unassigned} settlers unassigned</span>
            </div>
            <div style={priorityList}>
              {WORK_ROWS.map((row) => (
                <div key={row.category} style={priorityRow} data-testid={`work-row-${row.category}`}>
                  <span style={priorityCopy}>
                    <strong>{row.label}</strong>
                    <small>{row.purpose} · {economy.assigned[row.category]} assigned</small>
                  </span>
                  <span style={priorityButtons}>
                    {([0, 1, 2, 3] as WorkPriorityLevel[]).map((level) => (
                      <button
                        key={level}
                        type="button"
                        data-testid={`work-priority-${row.category}-${level}`}
                        aria-pressed={economy.priorities[row.category] === level}
                        title={level === 0 ? 'Disabled' : `Priority ${level}`}
                        onClick={() => props.setWorkPriority(row.category, level)}
                        style={economy.priorities[row.category] === level ? priorityButtonOn : priorityButton}
                      >
                        {level === 0 ? 'Off' : level}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <div style={toolRow}>
          <button
            type="button"
            data-testid="build-toggle"
            onClick={() => {
              const next = !menuOpen
              setMenuOpen(next)
              setPrioritiesOpen(false)
              if (!next) props.cancelPlacement()
            }}
            style={menuOpen ? primaryButtonOn : primaryButton}
          >
            <span aria-hidden>⌂</span> Build
          </button>
          <button
            type="button"
            data-testid="path-tool"
            aria-pressed={interaction.activeKind === 'path'}
            onClick={() => {
              setMenuOpen(false)
              setPrioritiesOpen(false)
              props.beginPath()
            }}
            style={interaction.activeKind === 'path' ? primaryButtonOn : primaryButton}
          >
            Path
          </button>
          <button
            type="button"
            data-testid="priorities-toggle"
            aria-expanded={prioritiesOpen}
            onClick={() => {
              setMenuOpen(false)
              setPrioritiesOpen((open) => !open)
              props.cancelPlacement()
            }}
            style={prioritiesOpen ? primaryButtonOn : primaryButton}
          >
            Priorities
          </button>
          {interaction.activeKind ? (
            <button type="button" data-testid="cancel-placement" onClick={props.cancelPlacement} style={secondaryButton}>
              Cancel placement
            </button>
          ) : null}
        </div>
      </div>

      {interaction.activeKind && interaction.preview ? (
        <div
          data-testid="placement-status"
          data-tone={interaction.preview.tone}
          style={{ ...placementBanner, borderColor: toneColor(interaction.preview.tone) }}
        >
          <strong>{interaction.preview.reason}</strong>
          <span>
            Tile {interaction.preview.x}, {interaction.preview.y}
            {interaction.preview.missingWood > 0 || interaction.preview.missingStone > 0
              ? ` · awaiting ${[
                  interaction.preview.missingWood > 0 ? `${interaction.preview.missingWood} wood` : '',
                  interaction.preview.missingStone > 0 ? `${interaction.preview.missingStone} stone` : '',
                ].filter(Boolean).join(' and ')}`
              : ''}
          </span>
        </div>
      ) : null}

      {selectedAgent ? (
        <aside style={selectionPanel} data-testid="resident-inspector">
          <div style={inspectorHeader}>
            <div>
              <div style={eyebrow}>Resident</div>
              <h2 style={{ ...selectionTitle, color: selectedAgent.color }}>{selectedAgent.name}</h2>
            </div>
            <button type="button" onClick={() => props.selectAgent(null)} style={closeButton} aria-label="Close resident inspector">×</button>
          </div>
          <div style={statusLine} data-testid="resident-action">
            <strong>{selectedAgent.action.kind.replace(/-/g, ' ')}</strong>
            <span>{selectedAgent.action.reason}</span>
          </div>
          {personaFor(selectedAgent.id) ? (
            <div style={diagnosticBlock} data-testid="resident-biography">
              <div style={miniHeading}>Biography and aspiration</div>
              <div>{personaFor(selectedAgent.id)}</div>
            </div>
          ) : null}
          {selectedMindDecision ? (
            <div style={mindChoice} data-testid="resident-mind-decision">
              <div style={miniHeading}>Mind-authored choice</div>
              <div>{selectedMindDecision.meta.reasoning}</div>
              <span>{selectedMindDecision.meta.provider} mind · recorded for replay</span>
            </div>
          ) : null}
          <div style={diagnosticBlock} data-testid="resident-needs">
            <div style={miniHeading}>Needs</div>
            <NeedBar label="Food" value={selectedAgent.needs.hunger} />
            <NeedBar label="Rest" value={selectedAgent.needs.energy} />
            <NeedBar label="Social" value={selectedAgent.needs.social} />
          </div>
          <div style={diagnosticBlock}>
            <div style={diagnosticRow}><span>Home</span><strong>{residentHomeLabel(selectedAgent, currentWorld)}</strong></div>
            <div style={diagnosticRow}><span>Work</span><strong>{residentWorkLabel(selectedAgent, currentWorld)}</strong></div>
            <div style={diagnosticRow}><span>Wallet</span><strong>{Math.floor(selectedAgent.wallet)} coins</strong></div>
            <div style={diagnosticRow}>
              <span>Carrying</span>
              <strong>{(['food', 'wood', 'stone'] as Good[]).filter((good) => selectedAgent.inventory[good] > 0).map((good) => `${selectedAgent.inventory[good]} ${good}`).join(', ') || 'Nothing'}</strong>
            </div>
          </div>
          <div style={diagnosticBlock} data-testid="resident-observed-facts">
            <div style={miniHeading}>Player-made facts observed</div>
            {(selectedAgent.observedFacts ?? []).length > 0
              ? (selectedAgent.observedFacts ?? []).slice(-3).reverse().map((fact) => (
                  <div key={fact.id} style={residentFact}>{fact.text}</div>
                ))
              : <div style={emptyPulse}>No player change observed yet.</div>}
          </div>
          <div style={diagnosticBlock} data-testid="resident-relationship">
            <div style={miniHeading}>Closest relationship</div>
            <div style={diagnosticRow}>
              <span>{selectedRelationship?.name ?? 'No bond yet'}</span>
              <strong>{selectedRelationship ? `${Math.round(selectedRelationship.value * 100)}%` : '—'}</strong>
            </div>
          </div>
        </aside>
      ) : selected ? (
        <aside style={selectionPanel} data-testid="selection-panel">
          <div style={eyebrow}>Selected</div>
          <h2 style={selectionTitle}>{selectedLabel}</h2>
          <div style={selectionMeta}>Tile {selected.x}, {selected.y}</div>
          {DEMOLISHABLE.has(selected.kind as BuildableKind) ? (
            <div style={diagnosticBlock} data-testid="building-tier">
              <div style={diagnosticRow}><span>Building tier</span><strong>Level {placeLevel(selected)} / {MAX_PLACE_LEVEL}</strong></div>
              {placeLevel(selected) < MAX_PLACE_LEVEL ? (
                <button
                  type="button"
                  data-testid="upgrade-building"
                  disabled={!upgradesUnlocked(currentWorld)}
                  onClick={() => props.upgradePlace(selected.id)}
                  style={upgradesUnlocked(currentWorld) ? upgradeButton : disabledButton}
                >
                  {upgradesUnlocked(currentWorld) ? `Upgrade to level ${placeLevel(selected) + 1}` : 'Unlock upgrades at Town - 85 Appeal'}
                </button>
              ) : <div style={growthNext}>Highest tier reached.</div>}
            </div>
          ) : null}
          {selectedCapacity > 0 ? (
            <div style={diagnosticRow} data-testid="selected-workers">
              <span>Workers</span><strong>{selectedWorkers} / {selectedCapacity}</strong>
            </div>
          ) : null}
          {selectedStatus ? (
            <div style={selectedStatus.startsWith('Stalled') || selectedStatus.startsWith('Waiting') ? stallLine : statusLine} data-testid="selected-status">
              {selectedStatus}
            </div>
          ) : null}
          {selected.production ? (
            <div style={diagnosticBlock} data-testid="production-diagnostics">
              <div style={diagnosticRow}>
                <span>Output</span>
                <strong>{selected.production.yield} {selected.production.good}</strong>
              </div>
              <div style={diagnosticRow}>
                <span>Cycle</span>
                <strong>{Math.round((selected.growth ?? 0) * 100)}%</strong>
              </div>
              <div style={diagnosticRow}>
                <span>On site</span>
                <strong>{Math.floor(selected.inventory[selected.production.good] ?? 0)} {selected.production.good}</strong>
              </div>
              <div style={selectionMeta}>One batch every {selected.production.cycleWorkedTicks} worked minutes.</div>
            </div>
          ) : null}
          {selected.kind === 'storehouse' ? (
            <div style={diagnosticBlock} data-testid="stockpile-diagnostics">
              <div style={miniHeading}>Storehouse intake</div>
              {(['food', 'wood', 'stone'] as Good[]).map((good) => {
                const enabled = selected.storageFilters?.[good] !== false
                return (
                  <div key={good} style={filterRow}>
                    <span style={{ textTransform: 'capitalize' }}>{good} · {Math.floor(selected.inventory[good] ?? 0)}</span>
                    <button
                      type="button"
                      data-testid={`stockpile-filter-${good}`}
                      aria-pressed={enabled}
                      onClick={() => props.setStockpileFilter(selected.id, good, !enabled)}
                      style={enabled ? filterButtonOn : filterButton}
                    >
                      {enabled ? 'Accepting' : 'Blocked'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
          {selected.kind === 'construction-site' ? (
            <>
              <div style={progressTrack}>
                <div style={{ ...progressFill, width: `${Math.round(constructionProgress * 100)}%` }} />
              </div>
              <div style={selectionMeta}>{Math.round(constructionProgress * 100)}% built</div>
              <div style={billLine}>
                Needs {selected.construction?.needs.wood ?? 0} wood · {selected.construction?.needs.stone ?? 0} stone
              </div>
              <div style={diagnosticBlock} data-testid="construction-diagnostics">
                <div style={diagnosticRow}>
                  <span>Original bill</span>
                  <strong>{selectedRecipe?.wood ?? 0}W · {selectedRecipe?.stone ?? 0}S</strong>
                </div>
                <div style={diagnosticRow}>
                  <span>Delivered on site</span>
                  <strong>{Math.floor(selected.inventory.wood ?? 0)}W · {Math.floor(selected.inventory.stone ?? 0)}S</strong>
                </div>
                <div style={diagnosticRow}>
                  <span>Remaining bill</span>
                  <strong>{selected.construction?.needs.wood ?? 0}W · {selected.construction?.needs.stone ?? 0}S</strong>
                </div>
                <div style={miniHeading}>Site priority</div>
                <div style={sitePriorityButtons}>
                  {([1, 2, 3] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      data-testid={`construction-priority-${priority}`}
                      aria-pressed={(selected.construction?.priority ?? 2) === priority}
                      onClick={() => props.setConstructionPriority(selected.id, priority)}
                      style={(selected.construction?.priority ?? 2) === priority ? priorityButtonOn : priorityButton}
                    >
                      {priority}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" data-testid="cancel-construction" onClick={props.cancelSelected} style={dangerButton}>
                Cancel construction
              </button>
            </>
          ) : DEMOLISHABLE.has(selected.kind as BuildableKind) ? (
            <button type="button" data-testid="demolish-building" onClick={props.demolishSelected} style={dangerButton}>
              Demolish
            </button>
          ) : null}
        </aside>
      ) : null}

      {interaction.hovered && !interaction.activeKind ? (
        <div
          style={{ ...hoverTooltip, left: interaction.hovered.x + 14, top: interaction.hovered.y + 14 }}
          data-testid="world-hover-label"
          data-kind={interaction.hovered.kind}
        >
          <strong>{interaction.hovered.label}</strong>
          <span>{interaction.hovered.detail}</span>
        </div>
      ) : null}

      {recentSays.map((say) => {
        const point = props.screenForAgent(say.agentId)
        if (!point) return null
        return <button key={`${say.conversationId}-${say.turn}`} type="button" data-testid="world-conversation" style={{ ...speechBubble, left: point.x, top: point.y - 58 }} onClick={() => props.selectAgent(say.agentId)}>{say.text}</button>
      })}

      <div style={messageBar} data-testid="town-message">{interaction.message}</div>
    </div>
  )
}

function Resource(props: { glyph: string; label: string; value: number }): ReactElement {
  return (
    <span style={resourceChip} title={props.label}>
      <span style={resourceGlyph} aria-hidden>{props.glyph}</span>
      <strong>{props.value}</strong>
      <span style={resourceLabel}>{props.label}</span>
    </span>
  )
}

function NeedBar(props: { label: string; value: number }): ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(props.value * 100)))
  const color = pct < 25 ? '#e06859' : pct < 50 ? '#e0ad55' : '#75cf84'
  return (
    <div style={needRow}>
      <span>{props.label}</span>
      <span style={needTrack}><span style={{ ...needFill, width: `${pct}%`, background: color }} /></span>
      <strong>{pct}%</strong>
    </div>
  )
}

function alertColor(severity: 'critical' | 'warning' | 'info'): string {
  if (severity === 'critical') return '#df6858'
  if (severity === 'warning') return '#d6a24c'
  return '#6bbf82'
}

function toneColor(tone: 'valid' | 'warning' | 'invalid'): string {
  if (tone === 'valid') return '#69d77b'
  if (tone === 'warning') return '#f2b84b'
  return '#e65d57'
}

function countdownTone(status: ScenarioView['status']): CSSProperties {
  if (status === 'storm') return { borderColor: '#7eb4d4', background: 'rgba(38,74,96,0.72)' }
  if (status === 'survived') return { borderColor: '#69d77b', background: 'rgba(49,104,59,0.68)' }
  if (status === 'failed') return { borderColor: '#e76e60', background: 'rgba(117,43,36,0.68)' }
  return { borderColor: '#d2b36e', background: 'rgba(100,75,38,0.65)' }
}

const hudRoot: CSSProperties = {
  position: 'absolute',
  inset: 0,
  color: '#f3efe4',
  font: '13px/1.3 Inter, ui-sans-serif, system-ui, sans-serif',
  pointerEvents: 'none',
  userSelect: 'none',
}

const stormOverlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  background: [
    'repeating-linear-gradient(112deg, transparent 0 18px, rgba(185,220,236,0.2) 19px 21px, transparent 22px 39px)',
    'radial-gradient(circle at 50% 45%, rgba(31,54,66,0.05), rgba(9,20,29,0.58) 78%)',
  ].join(','),
  boxShadow: 'inset 0 0 130px rgba(4,13,20,0.75)',
  pointerEvents: 'none',
}

const topBar: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  minHeight: 42,
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '8px 14px',
  boxSizing: 'border-box',
  background: 'linear-gradient(180deg, rgba(20,16,12,0.93), rgba(20,16,12,0.66))',
  borderBottom: '1px solid rgba(228,207,158,0.22)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  pointerEvents: 'auto',
  zIndex: 3,
}

const clock: CSSProperties = { fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 190 }
const resourceGroup: CSSProperties = { display: 'flex', gap: 7, flex: 1, justifyContent: 'center' }
const resourceChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 8px',
  border: '1px solid rgba(228,207,158,0.16)',
  borderRadius: 5,
  background: 'rgba(255,248,226,0.055)',
  fontVariantNumeric: 'tabular-nums',
}
const mindChip: CSSProperties = {
  ...resourceChip,
  color: '#bff4df',
  borderColor: 'rgba(126,207,177,0.42)',
  fontSize: 9,
}
const resourceGlyph: CSSProperties = { color: '#d9bd73' }
const resourceLabel: CSSProperties = { opacity: 0.62, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }
const speedGroup: CSSProperties = { display: 'flex', gap: 4 }
const speedButton: CSSProperties = {
  border: '1px solid rgba(228,207,158,0.2)',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.05)',
  color: '#ded8ca',
  padding: '4px 8px',
  cursor: 'pointer',
  font: 'inherit',
}
const speedButtonOn: CSSProperties = { ...speedButton, background: '#755a2d', borderColor: '#d1ae67', color: '#fff7df' }

const scenarioPanel: CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 62,
  zIndex: 2,
  width: 326,
  padding: 15,
  boxSizing: 'border-box',
  borderRadius: 9,
  border: '1px solid rgba(228,207,158,0.34)',
  background: 'linear-gradient(150deg, rgba(40,31,22,0.96), rgba(22,24,25,0.95))',
  boxShadow: '0 16px 42px rgba(0,0,0,0.42)',
}
const scenarioEyebrow: CSSProperties = {
  color: '#d2b36e',
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
}
const scenarioHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 10,
  marginTop: 5,
}
const scenarioTitle: CSSProperties = { margin: 0, font: '800 19px/1.15 Georgia, serif' }
const scenarioPopulation: CSSProperties = { marginTop: 4, opacity: 0.68, fontSize: 11 }
const countdownBadge: CSSProperties = {
  minWidth: 91,
  padding: '6px 8px',
  border: '1px solid',
  borderRadius: 6,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}
const countdownLabel: CSSProperties = { display: 'block', opacity: 0.78, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }
const countdownValue: CSSProperties = { display: 'block', marginTop: 2, fontSize: 15 }
const objectiveList: CSSProperties = { display: 'grid', gap: 7, marginTop: 13 }
const objectiveRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '42px 1fr',
  gap: '4px 8px',
  alignItems: 'center',
  padding: '7px 8px',
  borderRadius: 5,
  background: 'rgba(255,248,226,0.055)',
  border: '1px solid rgba(228,207,158,0.13)',
}
const objectiveMark: CSSProperties = { color: '#e7b05c', fontSize: 9, fontWeight: 900, letterSpacing: '0.08em' }
const objectiveMarkMet: CSSProperties = { ...objectiveMark, color: '#78dc89' }
const objectiveCopy: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }
const objectiveTrack: CSSProperties = { gridColumn: '1 / span 2', height: 3, overflow: 'hidden', borderRadius: 2, background: 'rgba(255,255,255,0.1)' }
const objectiveFill: CSSProperties = { display: 'block', height: '100%', background: 'linear-gradient(90deg, #af873d, #75cd84)', transition: 'width 0.2s ease' }
const scenarioHint: CSSProperties = { margin: '10px 1px 0', color: 'rgba(244,232,205,0.72)', fontSize: 10.5 }
const stormWarning: CSSProperties = { ...scenarioHint, color: '#cbe8f5' }
const successNotice: CSSProperties = { ...scenarioHint, color: '#9de7aa', fontWeight: 700 }
const failureNotice: CSSProperties = { ...scenarioHint, color: '#ffaaa0', fontWeight: 700 }

const townPulsePanel: CSSProperties = {
  position: 'absolute',
  right: 16,
  top: 58,
  zIndex: 2,
  width: 332,
  height: 230,
  padding: 11,
  boxSizing: 'border-box',
  borderRadius: 8,
  border: '1px solid rgba(228,207,158,0.28)',
  background: 'linear-gradient(150deg, rgba(35,29,23,0.97), rgba(23,24,23,0.96))',
  boxShadow: '0 14px 36px rgba(0,0,0,0.38)',
  pointerEvents: 'auto',
}
const townPulsePanelGrowth: CSSProperties = { ...townPulsePanel, height: 390 }
const pulseHeader: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 11 }
const overlayBar: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 8, paddingBottom: 7, borderBottom: '1px solid rgba(228,207,158,0.12)' }
const overlayLabel: CSSProperties = { marginRight: 3, opacity: 0.58, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }
const compactButton: CSSProperties = {
  border: '1px solid rgba(228,207,158,0.18)',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.045)',
  color: '#dcd4c3',
  padding: '3px 6px',
  cursor: 'pointer',
  font: '700 9px/1.2 ui-sans-serif, system-ui, sans-serif',
}
const compactButtonOn: CSSProperties = { ...compactButton, background: '#73552b', borderColor: '#cba75f', color: '#fff3d8' }
const pulseActions: CSSProperties = { display: 'flex', gap: 4 }
const pulseColumns: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 6, height: 106, overflow: 'hidden' }
const pulseScroll: CSSProperties = { marginTop: 6, height: 106, overflowY: 'auto', paddingRight: 3 }
const pulseScrollGrowth: CSSProperties = { ...pulseScroll, height: 268 }
const pulseSubheading: CSSProperties = { margin: '2px 0 4px', color: '#d2b36e', fontSize: 8.5, fontWeight: 850, letterSpacing: '0.09em', textTransform: 'uppercase' }
const alertRow: CSSProperties = {
  display: 'grid',
  width: '100%',
  gap: 1,
  marginBottom: 3,
  padding: '3px 4px',
  border: 0,
  borderLeft: '3px solid',
  borderRadius: 3,
  background: 'rgba(255,248,226,0.045)',
  color: '#eee5d3',
  textAlign: 'left',
  cursor: 'pointer',
  font: '9px/1.15 ui-sans-serif, system-ui, sans-serif',
}
const storyRow: CSSProperties = {
  display: 'block',
  width: '100%',
  marginBottom: 3,
  padding: '3px 4px',
  border: 0,
  borderRadius: 3,
  background: 'rgba(255,248,226,0.035)',
  color: 'rgba(243,236,218,0.78)',
  textAlign: 'left',
  cursor: 'pointer',
  font: '9px/1.25 ui-sans-serif, system-ui, sans-serif',
}
const ruleRow: CSSProperties = { marginBottom: 3, padding: '3px 4px', borderRadius: 3, background: 'rgba(255,248,226,0.04)', fontSize: 9 }
const emptyPulse: CSSProperties = { opacity: 0.5, fontSize: 9, padding: '2px 4px' }
const growthLead: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }
const appealTrack: CSSProperties = { height: 4, margin: '4px 0 5px', borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.1)' }
const appealFill: CSSProperties = { display: 'block', height: '100%', background: 'linear-gradient(90deg, #a97935, #7dd58b)' }
const growthComponents: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }
const growthComponent: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 5, fontSize: 8.5, opacity: 0.82 }
const growthNext: CSSProperties = { marginTop: 5, padding: '3px 4px', borderRadius: 3, background: 'rgba(255,248,226,0.04)', fontSize: 8.5, opacity: 0.72 }
const candidateCard: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 6, marginBottom: 4, padding: 5, borderRadius: 4, border: '1px solid rgba(210,179,110,0.2)', background: 'rgba(255,248,226,0.05)', fontSize: 9 }
const candidateCopy: CSSProperties = { display: 'grid', gap: 2 }
const inviteButton: CSSProperties = { ...compactButton, color: '#d5f3d8', borderColor: 'rgba(105,215,123,0.55)', background: 'rgba(72,126,75,0.32)' }

const bottomLeft: CSSProperties = { position: 'absolute', left: 18, bottom: 44, pointerEvents: 'auto', zIndex: 2 }
const buildPanel: CSSProperties = {
  width: 'min(720px, calc(100vw - 36px))',
  marginBottom: 9,
  padding: 12,
  borderRadius: 8,
  border: '1px solid rgba(228,207,158,0.28)',
  background: 'linear-gradient(150deg, rgba(40,31,22,0.97), rgba(26,23,19,0.96))',
  boxShadow: '0 16px 42px rgba(0,0,0,0.4)',
}
const panelHeading: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, fontWeight: 800, letterSpacing: '0.03em' }
const panelHint: CSSProperties = { fontSize: 11, opacity: 0.58, fontWeight: 500, letterSpacing: 0 }
const buildGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 7 }
const buildCard: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '28px 1fr',
  gridTemplateRows: 'auto auto',
  alignItems: 'center',
  gap: '2px 6px',
  padding: '8px 9px',
  minHeight: 54,
  borderRadius: 5,
  border: '1px solid rgba(228,207,158,0.18)',
  background: 'rgba(255,248,226,0.055)',
  color: '#eee6d4',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
}
const buildCardActive: CSSProperties = { ...buildCard, borderColor: '#69d77b', background: 'rgba(80,145,82,0.22)', boxShadow: 'inset 0 0 0 1px rgba(105,215,123,0.24)' }
const buildCardLocked: CSSProperties = { ...buildCard, cursor: 'not-allowed', opacity: 0.48, filter: 'saturate(0.45)' }
const buildGlyph: CSSProperties = { gridRow: '1 / span 2', fontSize: 23, color: '#d9bd73', textAlign: 'center' }
const buildName: CSSProperties = { fontWeight: 750, fontSize: 12 }
const buildCost: CSSProperties = { opacity: 0.58, fontSize: 10 }
const toolRow: CSSProperties = { display: 'flex', gap: 7 }
const priorityPanel: CSSProperties = {
  ...buildPanel,
  width: 'min(560px, calc(100vw - 36px))',
}
const priorityList: CSSProperties = { display: 'grid', gap: 6 }
const priorityRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 12,
  padding: '7px 8px',
  borderRadius: 5,
  background: 'rgba(255,248,226,0.045)',
  border: '1px solid rgba(228,207,158,0.12)',
}
const priorityCopy: CSSProperties = { display: 'grid', gap: 1 }
const priorityButtons: CSSProperties = { display: 'flex', gap: 4 }
const priorityButton: CSSProperties = {
  minWidth: 32,
  border: '1px solid rgba(228,207,158,0.2)',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.05)',
  color: '#ded8ca',
  padding: '4px 6px',
  cursor: 'pointer',
  font: '700 11px/1.2 ui-sans-serif, system-ui, sans-serif',
}
const priorityButtonOn: CSSProperties = {
  ...priorityButton,
  color: '#fff8e7',
  borderColor: '#d1ae67',
  background: '#755a2d',
}
const primaryButton: CSSProperties = {
  border: '1px solid #b99351',
  borderRadius: 6,
  background: 'linear-gradient(180deg, #785a2d, #513b20)',
  color: '#fff4d8',
  padding: '9px 18px',
  font: '700 14px/1 ui-sans-serif, system-ui, sans-serif',
  cursor: 'pointer',
  boxShadow: '0 6px 16px rgba(0,0,0,0.28)',
}
const primaryButtonOn: CSSProperties = { ...primaryButton, borderColor: '#e1c177', boxShadow: '0 0 0 2px rgba(225,193,119,0.18), 0 6px 16px rgba(0,0,0,0.28)' }
const secondaryButton: CSSProperties = { ...speedButton, padding: '8px 12px', background: 'rgba(32,27,22,0.9)' }

const placementBanner: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 48,
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '8px 14px',
  border: '1px solid',
  borderRadius: 6,
  background: 'rgba(21,18,15,0.92)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
}

const selectionPanel: CSSProperties = {
  position: 'absolute',
  right: 16,
  top: 298,
  width: 304,
  maxHeight: 'calc(100% - 350px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 14,
  borderRadius: 8,
  border: '1px solid rgba(228,207,158,0.28)',
  background: 'linear-gradient(150deg, rgba(40,31,22,0.97), rgba(25,22,18,0.96))',
  boxShadow: '0 14px 36px rgba(0,0,0,0.38)',
  pointerEvents: 'auto',
  zIndex: 2,
}
const inspectorHeader: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }
const closeButton: CSSProperties = { ...compactButton, width: 24, height: 24, padding: 0, fontSize: 16 }
const eyebrow: CSSProperties = { color: '#d2b36e', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }
const selectionTitle: CSSProperties = { margin: '5px 0 2px', font: '800 20px/1.1 Georgia, serif', textTransform: 'capitalize' }
const selectionMeta: CSSProperties = { opacity: 0.62, fontSize: 11, marginTop: 5 }
const progressTrack: CSSProperties = { height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 13 }
const progressFill: CSSProperties = { height: '100%', background: 'linear-gradient(90deg, #8e6c35, #d0b467)', transition: 'width 0.2s ease' }
const billLine: CSSProperties = { marginTop: 9, padding: '7px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', fontSize: 11 }
const diagnosticBlock: CSSProperties = {
  display: 'grid',
  gap: 5,
  marginTop: 10,
  padding: '8px 9px',
  borderRadius: 5,
  background: 'rgba(255,248,226,0.045)',
  border: '1px solid rgba(228,207,158,0.12)',
}
const diagnosticRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  marginTop: 7,
  fontSize: 11,
}
const needRow: CSSProperties = { display: 'grid', gridTemplateColumns: '42px 1fr 34px', alignItems: 'center', gap: 6, fontSize: 10 }
const needTrack: CSSProperties = { display: 'block', height: 5, overflow: 'hidden', borderRadius: 3, background: 'rgba(255,255,255,0.1)' }
const needFill: CSSProperties = { display: 'block', height: '100%', borderRadius: 3 }
const miniHeading: CSSProperties = {
  marginTop: 3,
  color: '#d2b36e',
  fontSize: 9,
  fontWeight: 850,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
}
const residentFact: CSSProperties = { padding: '4px 5px', borderLeft: '2px solid rgba(210,179,110,0.55)', background: 'rgba(255,248,226,0.035)', fontSize: 9.5 }
const mindChoice: CSSProperties = {
  ...diagnosticBlock,
  borderColor: 'rgba(126, 207, 177, 0.42)',
  background: 'rgba(65, 132, 112, 0.13)',
  color: '#e8fff5',
  fontSize: 9.5,
  lineHeight: 1.35,
}
const upgradeButton: CSSProperties = { ...primaryButton, width: '100%', marginTop: 5, padding: '7px 10px', fontSize: 11 }
const disabledButton: CSSProperties = { ...upgradeButton, cursor: 'not-allowed', opacity: 0.48, filter: 'saturate(0.45)' }
const statusLine: CSSProperties = {
  display: 'grid',
  gap: 2,
  marginTop: 8,
  padding: '6px 8px',
  borderRadius: 4,
  color: '#a9e6b2',
  background: 'rgba(70,126,74,0.2)',
  fontSize: 10.5,
}
const stallLine: CSSProperties = {
  ...statusLine,
  color: '#ffd393',
  background: 'rgba(143,86,35,0.24)',
}
const replayPass: CSSProperties = {
  ...stallLine,
  color: '#bff4df',
  borderColor: 'rgba(126,207,177,0.42)',
  background: 'rgba(65,132,112,0.13)',
}
const filterRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
}
const filterButton: CSSProperties = {
  ...priorityButton,
  minWidth: 70,
  color: '#e7a598',
  background: 'rgba(118,44,36,0.35)',
}
const filterButtonOn: CSSProperties = {
  ...filterButton,
  color: '#b7edbd',
  borderColor: 'rgba(105,215,123,0.5)',
  background: 'rgba(72,126,75,0.32)',
}
const sitePriorityButtons: CSSProperties = { display: 'flex', gap: 4 }
const dangerButton: CSSProperties = {
  width: '100%',
  marginTop: 12,
  border: '1px solid rgba(224,106,91,0.62)',
  borderRadius: 5,
  background: 'rgba(118,44,36,0.46)',
  color: '#ffd9d2',
  padding: '7px 10px',
  cursor: 'pointer',
  font: '700 12px/1.2 ui-sans-serif, system-ui, sans-serif',
}
const hoverTooltip: CSSProperties = {
  position: 'fixed',
  zIndex: 8,
  display: 'grid',
  maxWidth: 260,
  gap: 2,
  padding: '6px 8px',
  borderRadius: 5,
  border: '1px solid rgba(228,207,158,0.32)',
  background: 'rgba(23,19,16,0.94)',
  boxShadow: '0 8px 22px rgba(0,0,0,0.42)',
  pointerEvents: 'none',
  fontSize: 10,
}
const speechBubble: CSSProperties = {
  position: 'absolute',
  transform: 'translate(-50%, -100%)',
  maxWidth: 190,
  padding: '7px 9px',
  borderRadius: 10,
  border: '1px solid rgba(239,224,187,0.62)',
  background: 'rgba(27,23,19,0.94)',
  color: '#fff7df',
  font: '600 10px/1.25 ui-sans-serif, system-ui, sans-serif',
  boxShadow: '0 7px 18px rgba(0,0,0,0.36)',
  pointerEvents: 'auto',
  zIndex: 9,
}
const messageBar: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 10,
  transform: 'translateX(-50%)',
  padding: '4px 10px',
  borderRadius: 4,
  color: 'rgba(247,239,221,0.82)',
  background: 'rgba(18,15,12,0.58)',
  fontSize: 11,
  zIndex: 2,
}
