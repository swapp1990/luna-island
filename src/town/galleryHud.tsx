import type { CSSProperties, ReactElement } from 'react'
import {
  GALLERY_ROWS,
  GALLERY_STAGE_LABEL,
  GALLERY_STAGES,
  stagesFor,
  type GalleryRow,
  type GalleryStage,
} from './galleryCatalog'

export function GalleryHud(props: {
  fps: number
  selected: GalleryRow
  stage: GalleryStage
  onSelect: (id: string) => void
  onStage: (s: GalleryStage) => void
}): ReactElement {
  const { selected, stage } = props
  const allowed = stagesFor(selected)

  return (
    <>
      <aside style={side}>
        <div style={sideHead}>Kit</div>
        <div style={list}>
          {GALLERY_ROWS.map((row) => {
            const on = row.id === selected.id
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => props.onSelect(row.id)}
                style={on ? itemOn : item}
              >
                <span>{row.label}</span>
                {row.missing ? <span style={badge}>no glb</span> : null}
              </button>
            )
          })}
        </div>
      </aside>

      <div style={top}>
        <span style={title}>{selected.label}</span>
        <span style={muted}>
          {selected.missing
            ? 'Placeholder — not authored yet'
            : 'Authored scale, 1 m = 1 m. Left-drag orbit · wheel zoom'}
        </span>
        <a href="/town" style={link}>
          /town
        </a>
        <span style={fps}>{Math.round(props.fps)} fps</span>
      </div>

      <div style={bottom}>
        {GALLERY_STAGES.map((s) => {
          const ok = allowed.includes(s)
          return (
            <button
              key={s}
              type="button"
              disabled={!ok}
              onClick={() => ok && props.onStage(s)}
              style={!ok ? stageOff : s === stage ? stageOn : stageBtn}
            >
              {GALLERY_STAGE_LABEL[s]}
            </button>
          )
        })}
      </div>
    </>
  )
}

const panel: CSSProperties = {
  background: 'rgba(10,12,16,0.78)',
  color: '#c8ccd2',
  font: '12px/1.3 ui-sans-serif, system-ui, sans-serif',
  pointerEvents: 'auto',
  userSelect: 'none',
}

const side: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: 196,
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid rgba(255,255,255,0.08)',
}

const sideHead: CSSProperties = {
  padding: '12px 14px 8px',
  fontWeight: 600,
  color: '#e8e0cc',
  letterSpacing: '0.04em',
}

const list: CSSProperties = { overflowY: 'auto', padding: '0 8px 12px' }

const item: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  color: '#c8ccd2',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  font: 'inherit',
}

const itemOn: CSSProperties = {
  ...item,
  background: 'rgba(255,255,255,0.12)',
  color: '#e8e0cc',
}

const badge: CSSProperties = { fontSize: 10, opacity: 0.55, letterSpacing: '0.04em' }

const top: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 0,
  left: 196,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '10px 16px',
  background: 'linear-gradient(to bottom, rgba(10,12,16,0.82), rgba(10,12,16,0))',
  pointerEvents: 'none',
}

const title: CSSProperties = { fontWeight: 600, color: '#e8e0cc', fontSize: 14 }
const muted: CSSProperties = { opacity: 0.75 }
const link: CSSProperties = {
  pointerEvents: 'auto',
  color: '#c8d4c0',
  textDecoration: 'none',
  borderBottom: '1px solid rgba(200,212,192,0.4)',
}
const fps: CSSProperties = { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', opacity: 0.8 }

const bottom: CSSProperties = {
  position: 'absolute',
  left: 196,
  right: 0,
  bottom: 18,
  display: 'flex',
  justifyContent: 'center',
  gap: 8,
  pointerEvents: 'none',
}

const stageBtn: CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(10,12,16,0.75)',
  border: '1px solid rgba(255,255,255,0.14)',
  color: '#d8c9a8',
  padding: '7px 12px',
  borderRadius: 5,
  cursor: 'pointer',
  font: '12px ui-sans-serif, system-ui, sans-serif',
}

const stageOn: CSSProperties = {
  ...stageBtn,
  background: 'rgba(232,224,204,0.18)',
  borderColor: 'rgba(232,224,204,0.45)',
  color: '#e8e0cc',
}

const stageOff: CSSProperties = {
  ...stageBtn,
  opacity: 0.35,
  cursor: 'default',
}
