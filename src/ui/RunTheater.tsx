import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { SimStateBridge } from '../bridge'
import type { RunChangelog } from '../replay/runDiff'
import { groupMomentsByDay, type RunMoment } from '../replay/runMoments'
import {
  runBuildLabel,
  runParamsLabel,
  runStillUrl,
  type RunIndexEntry,
} from '../replay/runsApi'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const PANEL_BG = 'rgba(12, 16, 28, 0.92)'
const HAIR = '1px solid rgba(255,255,255,0.1)'

const chipBtn: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 9px',
  borderRadius: 8,
  border: HAIR,
  background: 'rgba(255,255,255,0.06)',
  color: '#c8ced8',
  cursor: 'pointer',
  lineHeight: 1.2,
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(200,206,216,0.7)',
  margin: '12px 0 6px',
}

/** Ops moments are harness telemetry; story moments are village history. */
function momentAccent(m: RunMoment): string {
  if (m.kind === 'ops') return '#e2703d'
  if (m.type === 'run:start' || m.type === 'run:end') return '#8ea2c6'
  if (m.type.startsWith('institution:') || m.type.startsWith('gathering:')) return '#ffb050'
  if (m.type.startsWith('discovery:')) return '#6fd3c0'
  if (m.type.startsWith('construction:') || m.type === 'ownership:transfer') return '#c9a227'
  if (m.type.startsWith('mind:')) return '#a98cf0'
  return '#9aa4b6'
}

function bytesLabel(n: number): string {
  if (n <= 0) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function RunTheater(props: {
  state: SimStateBridge
  runs: RunIndexEntry[]
  loadedRun: RunIndexEntry | null
  loading: boolean
  error: string | null
  moments: RunMoment[]
  activeMomentId: string | null
  changelog: RunChangelog | null
  playingRun: boolean
  inspectorOpen: boolean
  onRefresh: () => void
  onLoadRun: (id: string) => void
  onJumpToMoment: (id: string) => void
  onStepMoment: (delta: 1 | -1) => void
  onTogglePlayRun: () => void
}) {
  const {
    state,
    runs,
    loadedRun,
    loading,
    error,
    moments,
    activeMomentId,
    changelog,
    playingRun,
    inspectorOpen,
  } = props

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'moments' | 'changed'>('moments')
  const [showList, setShowList] = useState(true)

  const panelRight = inspectorOpen ? 328 : 14
  const days = useMemo(() => groupMomentsByDay(moments), [moments])

  // A freshly loaded run should show its chapters, not the picker.
  useEffect(() => {
    if (loadedRun) setShowList(false)
  }, [loadedRun])

  useEffect(() => {
    if (open && runs.length === 0 && !loading) props.onRefresh()
    // Refresh on open only; the list is small and re-scans are cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The HUD re-renders several times a second; keep the live handler in a ref
  // so the key listener is bound once instead of on every frame.
  const stepRef = useRef(props.onStepMoment)
  stepRef.current = props.onStepMoment

  // [ and ] step through chapters without leaving the 3D view.
  useEffect(() => {
    if (!open || moments.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === '[') {
        e.preventDefault()
        stepRef.current(-1)
      } else if (e.key === ']') {
        e.preventDefault()
        stepRef.current(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, moments.length])

  return (
    <>
      <button
        type="button"
        data-testid="run-theater-toggle"
        aria-label="Run theater"
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'absolute',
          top: 12,
          right: 98,
          zIndex: 14,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: open
            ? '1px solid rgba(160,200,255,0.55)'
            : '1px solid rgba(255,255,255,0.12)',
          background: open ? 'rgba(90, 140, 220, 0.35)' : 'rgba(12, 16, 28, 0.78)',
          backdropFilter: 'blur(8px)',
          color: open ? '#dbe8ff' : '#e8ecf4',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}
      >
        🎞
      </button>

      {open && (
        <div
          data-testid="run-theater"
          style={{
            position: 'absolute',
            top: 56,
            right: panelRight,
            width: 380,
            zIndex: 13,
            padding: '12px 12px 10px',
            background: PANEL_BG,
            backdropFilter: 'blur(10px)',
            borderRadius: 14,
            color: '#f2f4f8',
            border: HAIR,
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
            maxHeight: 'calc(100% - 140px)',
            overflowY: 'auto',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(200,206,216,0.8)',
              }}
            >
              Run theater
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                data-testid="run-refresh"
                onClick={props.onRefresh}
                style={chipBtn}
              >
                {loading ? '…' : '⟳'}
              </button>
              {loadedRun && (
                <button
                  type="button"
                  data-testid="run-change"
                  onClick={() => setShowList((v) => !v)}
                  style={chipBtn}
                >
                  {showList ? 'Back' : 'Runs'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div
              data-testid="run-error"
              style={{
                marginTop: 8,
                padding: '6px 8px',
                borderRadius: 8,
                background: 'rgba(220,70,70,0.18)',
                border: '1px solid rgba(220,70,70,0.4)',
                fontSize: 12,
                color: '#ffc9c9',
              }}
            >
              {error}
            </div>
          )}

          {/* ---- run picker ---- */}
          {(showList || !loadedRun) && (
            <div data-testid="run-list" style={{ marginTop: 8 }}>
              {runs.length === 0 && !loading && (
                <div style={{ fontSize: 12, lineHeight: 1.5, color: '#aeb6c4' }}>
                  No recorded runs in <code>artifacts/</code>. Finish a soak (
                  <code>node scripts/soak-political.mjs</code>) or write a sample
                  with <code>node scripts/make-run-fixture.mjs</code>.
                </div>
              )}
              {runs.map((r) => {
                const active = r.id === loadedRun?.id
                const c = r.headline?.counts ?? null
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-testid="run-card"
                    data-run-id={r.id}
                    disabled={!r.hasWorld}
                    onClick={() => props.onLoadRun(r.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: active
                        ? '1px solid rgba(160,200,255,0.55)'
                        : HAIR,
                      background: active
                        ? 'rgba(90, 140, 220, 0.22)'
                        : 'rgba(255,255,255,0.04)',
                      color: r.hasWorld ? '#e8ecf4' : '#8b93a2',
                      cursor: r.hasWorld ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: '#a8b0c0', marginTop: 2 }}>
                      {runParamsLabel(r) || (r.hasWorld ? 'no summary' : 'no world export')}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 5,
                        fontSize: 10,
                        color: '#9aa4b6',
                      }}
                    >
                      {c?.['institution:closed'] != null && (
                        <span>{c['institution:closed']} closed</span>
                      )}
                      {c?.['mind:say'] != null && <span>{c['mind:say']} said</span>}
                      {c?.['discovery:examined'] != null && (
                        <span>{c['discovery:examined']} examined</span>
                      )}
                      {r.hasJournal && <span>journal</span>}
                      {r.hasHighlights && <span>📷 reel</span>}
                      {r.worldBytes > 0 && <span>{bytesLabel(r.worldBytes)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* ---- loaded run ---- */}
          {loadedRun && !showList && (
            <>
              <div
                data-testid="run-loaded"
                data-run-id={loadedRun.id}
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: HAIR,
                  background: 'rgba(90, 140, 220, 0.14)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>{loadedRun.label}</div>
                <div style={{ fontSize: 11, color: '#a8b0c0', marginTop: 2 }}>
                  {runParamsLabel(loadedRun) || 'params not recorded'}
                </div>
                {runBuildLabel(loadedRun) && (
                  <div
                    data-testid="run-build"
                    style={{
                      fontSize: 10.5,
                      color: loadedRun.git?.dirty ? '#e0b070' : '#8b93a2',
                      marginTop: 3,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    }}
                  >
                    built from {runBuildLabel(loadedRun)}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  <button
                    type="button"
                    data-testid="run-play"
                    onClick={props.onTogglePlayRun}
                    style={{
                      ...chipBtn,
                      background: playingRun
                        ? 'rgba(90, 200, 140, 0.3)'
                        : 'rgba(255,255,255,0.08)',
                      color: playingRun ? '#c8ffe0' : '#c8ced8',
                    }}
                  >
                    {playingRun ? '⏸ Watching' : '▶ Watch run'}
                  </button>
                  <button
                    type="button"
                    data-testid="run-prev"
                    onClick={() => props.onStepMoment(-1)}
                    style={chipBtn}
                  >
                    ⟨ prev
                  </button>
                  <button
                    type="button"
                    data-testid="run-next"
                    onClick={() => props.onStepMoment(1)}
                    style={chipBtn}
                  >
                    next ⟩
                  </button>
                  <span style={{ fontSize: 10, color: '#8b93a2', marginLeft: 'auto' }}>
                    [ / ]
                  </span>
                </div>
                <div style={{ fontSize: 10, color: '#8b93a2', marginTop: 6 }}>
                  Viewing Day {state.day} {pad2(state.hour)}:{pad2(state.minute)} ·{' '}
                  {state.mode === 'replay' ? 'replay' : 'live head'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {(['moments', 'changed'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-testid={`run-tab-${t}`}
                    onClick={() => setTab(t)}
                    style={{
                      ...chipBtn,
                      flex: 1,
                      textAlign: 'center',
                      background:
                        tab === t ? 'rgba(90, 140, 220, 0.3)' : 'rgba(255,255,255,0.05)',
                      color: tab === t ? '#dbe8ff' : '#a8b0c0',
                    }}
                  >
                    {t === 'moments'
                      ? `Moments (${moments.length})`
                      : 'What changed'}
                  </button>
                ))}
              </div>

              {tab === 'moments' && (
                <div data-testid="run-moments" style={{ marginTop: 4 }}>
                  {moments.length === 0 && (
                    <div style={{ fontSize: 12, color: '#aeb6c4', marginTop: 8 }}>
                      This run recorded no notable moments.
                    </div>
                  )}
                  {days.map((group) => (
                    <div key={group.day}>
                      <div style={sectionLabel}>Day {group.day}</div>
                      {group.moments.map((m) => {
                        const active = m.id === activeMomentId
                        const accent = momentAccent(m)
                        return (
                          <button
                            key={m.id}
                            type="button"
                            data-testid="run-moment"
                            data-moment-id={m.id}
                            data-moment-tick={m.tick}
                            data-moment-kind={m.kind}
                            onClick={() => props.onJumpToMoment(m.id)}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              marginBottom: 4,
                              padding: '6px 8px 6px 10px',
                              borderRadius: 8,
                              borderLeft: `3px solid ${accent}`,
                              borderTop: 'none',
                              borderRight: 'none',
                              borderBottom: 'none',
                              background: active
                                ? 'rgba(90, 140, 220, 0.26)'
                                : 'rgba(255,255,255,0.04)',
                              color: '#e8ecf4',
                              cursor: 'pointer',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  fontFamily:
                                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                  fontSize: 11,
                                  color: accent,
                                  flexShrink: 0,
                                }}
                              >
                                {pad2(m.hour)}:{pad2(m.minute)}
                              </span>
                              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                                {m.caption}
                              </span>
                            </div>
                            {m.subtitle && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#a8b0c0',
                                  marginTop: 2,
                                  marginLeft: 44,
                                  lineHeight: 1.35,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {m.subtitle}
                              </div>
                            )}
                            {m.still && loadedRun && (
                              <img
                                data-testid="run-moment-still"
                                src={runStillUrl(loadedRun.id, m.still)}
                                alt=""
                                loading="lazy"
                                style={{
                                  display: 'block',
                                  width: 'calc(100% - 44px)',
                                  marginLeft: 44,
                                  marginTop: 5,
                                  borderRadius: 6,
                                  border: HAIR,
                                }}
                              />
                            )}
                            {m.kind === 'ops' && m.wallMin != null && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#c98a5f',
                                  marginLeft: 44,
                                  marginTop: 2,
                                }}
                              >
                                harness flag · t+{m.wallMin}m wall
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'changed' && (
                <div data-testid="run-changelog" style={{ marginTop: 4 }}>
                  {!changelog && (
                    <div style={{ fontSize: 12, color: '#aeb6c4', marginTop: 8 }}>
                      No changelog for this run.
                    </div>
                  )}
                  {changelog && (
                    <>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#a8b0c0',
                          marginTop: 8,
                          lineHeight: 1.5,
                        }}
                      >
                        {changelog.days.toFixed(1)} sim days compared —{' '}
                        {changelog.partialBefore
                          ? `from the earliest snapshot this run kept (tick ${changelog.fromTick})`
                          : 'from the world as it was made'}{' '}
                        to tick {changelog.toTick}.
                      </div>

                      {changelog.sections.map((sec) => (
                        <div key={sec.id} data-testid="changelog-section" data-section={sec.id}>
                          <div style={sectionLabel}>{sec.title}</div>
                          {sec.rows.map((row) => (
                            <div
                              key={row.label}
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: 8,
                                padding: '3px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                fontSize: 12,
                              }}
                            >
                              <span style={{ flex: 1, color: '#c8ced8' }}>{row.label}</span>
                              <span
                                style={{
                                  fontFamily:
                                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                  fontSize: 11.5,
                                  color: '#8b93a2',
                                }}
                              >
                                {row.before} → <b style={{ color: '#e8ecf4' }}>{row.after}</b>
                              </span>
                              {row.delta && (
                                <span
                                  style={{
                                    fontFamily:
                                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                    fontSize: 11,
                                    minWidth: 34,
                                    textAlign: 'right',
                                    color: row.dir === 'up' ? '#7fd8a4' : '#e88b8b',
                                  }}
                                >
                                  {row.delta}
                                </span>
                              )}
                            </div>
                          ))}
                          {sec.rows.some((r) => r.note) && (
                            <div style={{ fontSize: 10.5, color: '#8b93a2', marginTop: 3 }}>
                              {sec.rows
                                .filter((r) => r.note)
                                .map((r) => `${r.label}: ${r.note}`)
                                .join(' · ')}
                            </div>
                          )}
                          {sec.notes?.map((note) => (
                            <div
                              key={note}
                              style={{
                                fontSize: 11,
                                color: '#b9c1d0',
                                marginTop: 4,
                                lineHeight: 1.4,
                              }}
                            >
                              {note}
                            </div>
                          ))}
                        </div>
                      ))}

                      {changelog.firsts.length > 0 && (
                        <div data-testid="changelog-firsts">
                          <div style={sectionLabel}>Firsts</div>
                          {changelog.firsts.map((f) => (
                            <button
                              key={`${f.tick}-${f.label}`}
                              type="button"
                              onClick={() => props.onJumpToMoment(`tick:${f.tick}`)}
                              style={{
                                display: 'flex',
                                width: '100%',
                                gap: 8,
                                textAlign: 'left',
                                alignItems: 'baseline',
                                padding: '3px 0',
                                border: 'none',
                                background: 'transparent',
                                color: '#c8ced8',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              <span
                                style={{
                                  fontFamily:
                                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                  fontSize: 11,
                                  color: '#8ea2c6',
                                  flexShrink: 0,
                                }}
                              >
                                {f.clock}
                              </span>
                              <span>{f.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
