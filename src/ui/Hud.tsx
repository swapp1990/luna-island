import { useRef, useState, type CSSProperties } from 'react'
import type { SimStateBridge } from '../bridge'

const SPEEDS: Array<{ label: string; value: number }> = [
  { label: '⏸', value: 0 },
  { label: '1×', value: 1 },
  { label: '8×', value: 8 },
  { label: '64×', value: 64 },
]

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const menuBtn: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 12px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: '#e8ecf4',
  cursor: 'pointer',
}

export function Hud(props: {
  state: SimStateBridge
  onSetSpeed: (n: number) => void
  /** Sim clock string for last save (HH:MM), or null if never saved. */
  lastSavedClock: string | null
  onNewWorld: (seed: number) => void
  onExportWorld: () => void
  onImportWorld: (file: File) => void
}) {
  const { state, onSetSpeed, lastSavedClock, onNewWorld, onExportWorld, onImportWorld } = props
  const clock = `Day ${state.day} — ${pad2(state.hour)}:${pad2(state.minute)}`
  const [menuOpen, setMenuOpen] = useState(false)
  const [newWorldOpen, setNewWorldOpen] = useState(false)
  const [seedInput, setSeedInput] = useState('42')
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'rgba(12, 16, 28, 0.72)',
        backdropFilter: 'blur(8px)',
        borderRadius: 12,
        color: '#f2f4f8',
        fontSize: 14,
        userSelect: 'none',
        zIndex: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontWeight: 600,
          letterSpacing: 0.3,
          minWidth: 140,
        }}
      >
        {clock}
      </span>
      {lastSavedClock ? (
        <span
          data-testid="save-chip"
          title="Last autosave (sim clock)"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 8,
            background: 'rgba(120, 200, 140, 0.18)',
            border: '1px solid rgba(120, 200, 140, 0.35)',
            color: '#b8e6c4',
            whiteSpace: 'nowrap',
          }}
        >
          💾 {lastSavedClock}
        </span>
      ) : null}
      <div style={{ display: 'flex', gap: 6 }}>
        {SPEEDS.map((s) => {
          const active = state.speed === s.value
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onSetSpeed(s.value)}
              style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 8,
                border: active ? '1px solid rgba(255,200,120,0.55)' : '1px solid rgba(255,255,255,0.12)',
                background: active ? 'rgba(255, 176, 80, 0.35)' : 'rgba(255,255,255,0.06)',
                color: active ? '#ffe7c2' : '#d0d6e0',
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          data-testid="world-menu-btn"
          aria-label="World menu"
          onClick={() => {
            setMenuOpen((o) => !o)
            setNewWorldOpen(false)
          }}
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 16,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)',
            background: menuOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
            color: '#d0d6e0',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          ⚙
        </button>
        {menuOpen ? (
          <div
            data-testid="world-menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              minWidth: 180,
              padding: 6,
              background: 'rgba(16, 20, 34, 0.96)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
              zIndex: 20,
            }}
          >
            {!newWorldOpen ? (
              <>
                <button
                  type="button"
                  data-testid="menu-new-world"
                  style={menuBtn}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                  onClick={() => setNewWorldOpen(true)}
                >
                  New World
                </button>
                <button
                  type="button"
                  data-testid="menu-export"
                  style={menuBtn}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                  onClick={() => {
                    setMenuOpen(false)
                    onExportWorld()
                  }}
                >
                  Export World
                </button>
                <button
                  type="button"
                  data-testid="menu-import"
                  style={menuBtn}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                  onClick={() => {
                    fileRef.current?.click()
                  }}
                >
                  Import World
                </button>
              </>
            ) : (
              <div style={{ padding: '4px 6px' }}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Seed</div>
                <input
                  data-testid="new-world-seed"
                  type="number"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#f2f4f8',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    data-testid="new-world-confirm"
                    style={{
                      ...menuBtn,
                      flex: 1,
                      textAlign: 'center',
                      background: 'rgba(255, 176, 80, 0.3)',
                      border: '1px solid rgba(255,200,120,0.4)',
                    }}
                    onClick={() => {
                      const n = Number(seedInput)
                      if (!Number.isFinite(n)) return
                      setMenuOpen(false)
                      setNewWorldOpen(false)
                      onNewWorld(Math.trunc(n))
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    style={{
                      ...menuBtn,
                      flex: 1,
                      textAlign: 'center',
                      background: 'rgba(255,255,255,0.06)',
                    }}
                    onClick={() => setNewWorldOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            setMenuOpen(false)
            if (f) onImportWorld(f)
          }}
        />
      </div>
    </div>
  )
}
