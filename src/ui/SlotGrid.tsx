import type { CSSProperties } from 'react'
import type { Good, Inventory } from '../sim/types'

export const GOOD_ICON: Record<Good, string> = {
  food: '🫐',
  wood: '🪵',
  stone: '🪨',
}

export const GOOD_LABEL: Record<Good, string> = {
  food: 'food',
  wood: 'wood',
  stone: 'stone',
}

const GOODS: Good[] = ['food', 'wood', 'stone']

const slotStyle = (empty: boolean): CSSStyleDeclaration | CSSProperties => ({
  width: 44,
  height: 44,
  borderRadius: 8,
  background: empty ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)',
  border: empty
    ? '1px dashed rgba(255,255,255,0.12)'
    : '1px solid rgba(255,255,255,0.14)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  opacity: empty ? 0.4 : 1,
  flexShrink: 0,
})

/** Icon + count badge slot grid (agent or place inventory). */
export function SlotGrid(props: {
  inventory: Inventory | Partial<Record<Good, number>> | undefined
  /** Fixed slot count; pads empty slots. Default 4 for agents. */
  slots?: number
  /** Goods order; default food, wood, stone then empties. */
  goods?: Good[]
  testId?: string
  /** Keep inv-row container test id for agent inventory. */
  containerTestId?: string
}) {
  const order = props.goods ?? GOODS
  const slotCount = props.slots ?? 4
  const inv = props.inventory ?? {}
  const cells: Array<{ good: Good | null; count: number }> = []

  for (const g of order) {
    const n = Math.max(0, Math.floor(inv[g] ?? 0))
    if (n > 0) cells.push({ good: g, count: n })
  }
  while (cells.length < slotCount) {
    cells.push({ good: null, count: 0 })
  }
  const shown = cells.slice(0, slotCount)

  return (
    <div
      data-testid={props.containerTestId ?? props.testId ?? 'slot-grid'}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {shown.map((cell, i) => {
        const empty = !cell.good || cell.count <= 0
        return (
          <div
            key={i}
            data-testid="slot"
            data-good={cell.good ?? ''}
            data-count={cell.count}
            title={
              cell.good
                ? `${GOOD_LABEL[cell.good]}: ${cell.count}`
                : 'empty'
            }
            style={slotStyle(empty) as CSSProperties}
          >
            {!empty && cell.good ? (
              <>
                <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
                  {GOOD_ICON[cell.good]}
                </span>
                <span
                  style={{
                    position: 'absolute',
                    right: 2,
                    bottom: 1,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    background: 'rgba(0,0,0,0.55)',
                    borderRadius: 4,
                    padding: '0 3px',
                    lineHeight: '14px',
                    minWidth: 14,
                    textAlign: 'center',
                  }}
                >
                  {cell.count}
                </span>
                {/* Keep "food"/"wood"/"stone" text for existing e2e asserts */}
                <span
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                  }}
                >
                  {GOOD_LABEL[cell.good]} {cell.count}
                </span>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
