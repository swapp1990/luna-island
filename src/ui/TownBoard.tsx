import { useMemo, useState, type ReactNode } from 'react'
import type { AgentState, Proposal, Rule, SimEvent } from '../sim/types'
import { proposalTally } from '../sim/sim'
import { toSimTime } from '../sim/time'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function closesIn(closesTick: number, now: number): string {
  const left = Math.max(0, closesTick - now)
  const h = Math.floor(left / 60)
  const m = left % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${pad2(m)}m`
}

export function TownBoard(props: {
  proposals: readonly Proposal[]
  rules: readonly Rule[]
  events: readonly SimEvent[]
  agents: readonly AgentState[]
  replayTick: number
  inspectorOpen?: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelRight = props.inspectorOpen ? 328 : 14

  const openProps = useMemo(
    () => props.proposals.filter((p) => p.status === 'open'),
    [props.proposals],
  )
  const standing = useMemo(
    () => props.rules.filter((r) => r.active),
    [props.rules],
  )
  const sanctions = useMemo(
    () =>
      props.events
        .filter((e) => e.type === 'institution:sanctioned' && e.tick <= props.replayTick)
        .slice(-8)
        .reverse(),
    [props.events, props.replayTick],
  )

  const nameOf = (id: string): { name: string; color: string } => {
    const a = props.agents.find((x) => x.id === id)
    return { name: a?.name ?? id, color: a?.color ?? '#8a90a0' }
  }

  return (
    <>
      <button
        type="button"
        data-testid="town-board-toggle"
        aria-label="Town board"
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'absolute',
          top: 12,
          right: 56,
          zIndex: 14,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: open
            ? '1px solid rgba(255,200,120,0.55)'
            : '1px solid rgba(255,255,255,0.12)',
          background: open ? 'rgba(255, 176, 80, 0.35)' : 'rgba(12, 16, 28, 0.78)',
          backdropFilter: 'blur(8px)',
          color: open ? '#ffe7c2' : '#e8ecf4',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}
      >
        📜
      </button>

      {open && (
        <div
          data-testid="town-board"
          style={{
            position: 'absolute',
            top: 56,
            right: panelRight,
            width: 320,
            zIndex: 13,
            padding: '12px 12px 10px',
            background: 'rgba(12, 16, 28, 0.88)',
            backdropFilter: 'blur(10px)',
            borderRadius: 14,
            color: '#f2f4f8',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
            maxHeight: 'calc(100% - 140px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              opacity: 0.55,
              marginBottom: 10,
            }}
          >
            Town board
          </div>

          <Section title="Open proposals">
            {openProps.length === 0 ? (
              <Empty>No open proposals</Empty>
            ) : (
              openProps.map((p) => {
                const proposer = nameOf(p.proposerId)
                const tally = proposalTally(p)
                return (
                  <div
                    key={p.id}
                    data-testid="town-board-proposal"
                    data-proposal-id={p.id}
                    style={{
                      padding: '8px 8px 7px',
                      marginBottom: 8,
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 6 }}>
                      “{clip(p.text, 160)}”
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        opacity: 0.85,
                      }}
                    >
                      <span
                        data-testid="town-board-proposer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '1px 7px 1px 4px',
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: proposer.color,
                          }}
                        />
                        {proposer.name}
                      </span>
                      <span data-testid="town-board-tally" style={{ fontWeight: 700 }}>
                        yes {tally.yes} · no {tally.no}
                      </span>
                      <span style={{ opacity: 0.55, marginLeft: 'auto' }}>
                        closes in {closesIn(p.closesTick, props.replayTick)}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </Section>

          <Section title="Standing rules">
            {standing.length === 0 ? (
              <Empty>No posted rules</Empty>
            ) : (
              <div data-testid="town-board-rules">
                {standing.map((r) => {
                  const who = nameOf(r.proposerId)
                  const t = toSimTime(r.enactedTick)
                  return (
                    <div
                      key={r.id}
                      data-testid="town-board-rule"
                      data-rule-id={r.id}
                      style={{
                        fontSize: 12,
                        lineHeight: 1.4,
                        padding: '6px 4px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <div>“{clip(r.text, 160)}”</div>
                      <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
                        {who.name} · Day {t.day} {pad2(t.hour)}:{pad2(t.minute)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title="Recent sanctions">
            {sanctions.length === 0 ? (
              <Empty>No sanctions posted</Empty>
            ) : (
              <div data-testid="town-board-sanctions">
                {sanctions.map((e) => {
                  const from = String(e.data?.agentName ?? e.agentId ?? 'Someone')
                  const to = String(e.data?.targetName ?? e.data?.targetId ?? 'someone')
                  const why = String(e.data?.reason ?? '')
                  const t = toSimTime(e.tick)
                  return (
                    <div
                      key={e.seq}
                      data-testid="town-board-sanction"
                      style={{
                        fontSize: 11,
                        lineHeight: 1.35,
                        padding: '5px 4px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <span style={{ opacity: 0.5 }}>
                        {pad2(t.hour)}:{pad2(t.minute)} ·{' '}
                      </span>
                      {from} → {to}: “{clip(why, 90)}”
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </div>
      )}
    </>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          opacity: 0.5,
          marginBottom: 6,
        }}
      >
        {props.title}
      </div>
      {props.children}
    </div>
  )
}

function Empty(props: { children: ReactNode }) {
  return (
    <div style={{ opacity: 0.45, fontSize: 12, padding: '4px 0 2px' }}>{props.children}</div>
  )
}
