import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AGE_ONE_POPULATION,
  AGE_ONE_STABLE_DAYS,
  BUILDINGS,
  CELL_LABEL,
  GRID_SIZE,
  advanceDay,
  advanceTime,
  availableWorkers,
  canAfford,
  canPlaceBuilding,
  createAgeZeroState,
  distanceEfficiency,
  foodReserveDays,
  gatheringYield,
  getHearthIndex,
  getProjectIndex,
  growthConditions,
  placeBuilding,
  resourceForCell,
  setBuilderWorkers,
  setResourceWorkers,
  setSpeed,
  shelterCapacity,
  type AgeZeroState,
  type BuildingKind,
  type ResourceKind,
} from './game'

type Action =
  | { type: 'tick'; seconds: number }
  | { type: 'speed'; speed: AgeZeroState['speed'] }
  | { type: 'place'; building: BuildingKind; index: number }
  | { type: 'resourceWorkers'; index: number; workers: number }
  | { type: 'builders'; workers: number }
  | { type: 'advanceDays'; days: number }
  | { type: 'reset' }

type OpenPanel = 'build' | 'inspect' | 'progress' | 'help' | 'settings' | null

function reducer(state: AgeZeroState, action: Action): AgeZeroState {
  switch (action.type) {
    case 'tick': return advanceTime(state, action.seconds)
    case 'speed': return setSpeed(state, action.speed)
    case 'place': return placeBuilding(state, action.building, action.index)
    case 'resourceWorkers': return setResourceWorkers(state, action.index, action.workers)
    case 'builders': return setBuilderWorkers(state, action.workers)
    case 'advanceDays': {
      let next = state
      for (let day = 0; day < action.days; day += 1) next = advanceDay(next)
      return next
    }
    case 'reset': return createAgeZeroState()
  }
}

declare global {
  interface Window {
    __age0State?: AgeZeroState
    __age0Control?: {
      advanceDays: (days: number) => void
      reset: () => void
    }
  }
}

const CELL_MARK = {
  water: '≈',
  open: '·',
  forest: '▲',
  food: '●',
  stone: '◆',
  fiber: '≋',
}

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  fiber: 'Fiber',
}

const BUILDING_UI: Record<BuildingKind, { description: string; provides: string }> = {
  hearth: { description: 'Establishes the centre of the settlement beside fresh water.', provides: 'Settlement centre and water access' },
  leanTo: { description: 'A temporary shelter for the first Villagers.', provides: 'Shelter for 3 Villagers' },
  foodCache: { description: 'Keeps a larger reserve safe for growth and shortages.', provides: '30 additional Food storage' },
  toolRack: { description: 'Keeps shared gathering tools ready near the village.', provides: '25% better gathering efficiency' },
}

const MAP_ZOOM_MIN = 75
const MAP_ZOOM_MAX = 225
const MAP_ZOOM_STEP = 10

type PlacementGhost = { x: number; y: number; size: number; cellIndex: number | null; valid: boolean }
type PanGesture = { pointerId: number; startX: number; startY: number; startScrollLeft: number; startScrollTop: number; moved: boolean }
type ZoomAnchor = { pointerX: number; pointerY: number; scrollLeft: number; scrollTop: number; scrollWidth: number; scrollHeight: number }
type PointerPoint = { x: number; y: number }
type PinchGesture = { startDistance: number; startZoom: number }

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function formatUiCost(cost: Partial<Record<ResourceKind, number>>) {
  return Object.entries(cost).map(([resource, amount]) => `${amount} ${RESOURCE_LABEL[resource as ResourceKind]}`).join(' · ')
}

function nextGoal(state: AgeZeroState) {
  const projectIndex = getProjectIndex(state)
  const hearthIndex = getHearthIndex(state)
  if (projectIndex >= 0) {
    const project = state.cells[projectIndex].project!
    return { title: `Assign Builders to the ${BUILDINGS[project].label}`, detail: `I must assign Builders before the ${BUILDINGS[project].label} can be completed.` }
  }
  if (hearthIndex < 0) return { title: 'Build a Hearth', detail: 'I must establish the village on open ground beside water.' }
  if (Object.values(state.assignments).reduce((sum, workers) => sum + workers, 0) === 0) {
    return { title: 'Assign Villagers to Food', detail: 'My people need a steady Food supply before the camp can grow.' }
  }
  if (shelterCapacity(state) <= state.population) return { title: 'Provide spare shelter', detail: 'The village needs at least one unused shelter space for a newcomer.' }
  if (foodReserveDays(state) < 2) return { title: 'Store two days of Food', detail: 'I must build a reserve large enough to support another Villager.' }
  if (state.population < AGE_ONE_POPULATION) return { title: 'Reach 12 Villagers', detail: 'The village will grow while shelter, water, and Food remain secure.' }
  return { title: `Remain stable for ${AGE_ONE_STABLE_DAYS} days`, detail: 'I must keep all 12 Villagers supplied until the camp becomes permanent.' }
}

function conditionLabel(key: keyof ReturnType<typeof growthConditions>['conditions']) {
  return {
    hearth: 'Hearth has water',
    sheltered: 'Everyone sheltered',
    spareShelter: 'One spare shelter',
    food: 'Two days of Food',
    fed: 'No starvation',
  }[key]
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function AgeZeroExperience() {
  const [state, dispatch] = useReducer(reducer, undefined, createAgeZeroState)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  const [placement, setPlacement] = useState<BuildingKind | null>('hearth')
  const [placementGhost, setPlacementGhost] = useState<PlacementGhost | null>(null)
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null)
  const [buildPreview, setBuildPreview] = useState<BuildingKind>('hearth')
  const [showLegend, setShowLegend] = useState(true)
  const [adviceExpanded, setAdviceExpanded] = useState(false)
  const [showAgeOne, setShowAgeOne] = useState(true)
  const [mapZoom, setMapZoom] = useState(100)
  const [isPanning, setIsPanning] = useState(false)
  const lastFrame = useRef(performance.now())
  const mapFrameRef = useRef<HTMLDivElement>(null)
  const mapViewportRef = useRef<HTMLDivElement>(null)
  const panGesture = useRef<PanGesture | null>(null)
  const pinchGesture = useRef<PinchGesture | null>(null)
  const activeTouches = useRef(new Map<number, PointerPoint>())
  const suppressCellClick = useRef(false)
  const lastMapPointer = useRef<{ x: number; y: number } | null>(null)
  const mapZoomRef = useRef(mapZoom)
  const zoomAnchor = useRef<ZoomAnchor | null>(null)

  const selected = selectedCell === null ? null : state.cells[selectedCell]
  const projectIndex = getProjectIndex(state)
  const goal = nextGoal(state)
  const growth = growthConditions(state)
  const reserve = foodReserveDays(state)
  const progressValue = state.population < AGE_ONE_POPULATION
    ? ((state.population - 6) / (AGE_ONE_POPULATION - 6)) * 50
    : 50 + (state.stableDays / AGE_ONE_STABLE_DAYS) * 50
  const ageHolding = state.population >= AGE_ONE_POPULATION

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      dispatch({ type: 'tick', seconds: Math.min(0.5, (now - lastFrame.current) / 1000) })
      lastFrame.current = now
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    window.__age0State = state
    window.__age0Control = { advanceDays: (days) => dispatch({ type: 'advanceDays', days }), reset: () => dispatch({ type: 'reset' }) }
  }, [state])

  useEffect(() => {
    if (state.ageOne) { setShowAgeOne(true); setOpenPanel(null) }
  }, [state.ageOne])

  const centerMap = useCallback(() => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(centerMap)
    return () => window.cancelAnimationFrame(frame)
  }, [centerMap])

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const viewport = mapViewportRef.current
    if (!anchor || !viewport) return
    const widthRatio = anchor.scrollWidth > 0 ? viewport.scrollWidth / anchor.scrollWidth : 1
    const heightRatio = anchor.scrollHeight > 0 ? viewport.scrollHeight / anchor.scrollHeight : 1
    viewport.scrollLeft = clamp((anchor.scrollLeft + anchor.pointerX) * widthRatio - anchor.pointerX, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth))
    viewport.scrollTop = clamp((anchor.scrollTop + anchor.pointerY) * heightRatio - anchor.pointerY, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
    zoomAnchor.current = null
  }, [mapZoom])

  const setZoomAtPoint = useCallback((requestedZoom: number, clientX: number, clientY: number) => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    const nextZoom = clamp(Math.round(requestedZoom), MAP_ZOOM_MIN, MAP_ZOOM_MAX)
    if (nextZoom === mapZoomRef.current) return
    const rect = viewport.getBoundingClientRect()
    zoomAnchor.current = {
      pointerX: clamp(clientX - rect.left, 0, viewport.clientWidth),
      pointerY: clamp(clientY - rect.top, 0, viewport.clientHeight),
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      scrollWidth: viewport.scrollWidth,
      scrollHeight: viewport.scrollHeight,
    }
    mapZoomRef.current = nextZoom
    setMapZoom(nextZoom)
  }, [])

  const zoomFromCentre = useCallback((requestedZoom: number) => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    setZoomAtPoint(requestedZoom, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [setZoomAtPoint])

  const cellLabels = useMemo(() => state.cells.map((cell, index) => {
    if (cell.project) return `${BUILDINGS[cell.project].label} construction site`
    if (cell.building) return BUILDINGS[cell.building].label
    const villagers = state.assignments[index] ?? 0
    return `${CELL_LABEL[cell.kind]}${villagers ? `, ${villagers} ${villagers === 1 ? 'Villager' : 'Villagers'} assigned` : ''}`
  }), [state.assignments, state.cells])

  const placementReason = useCallback((kind: BuildingKind, cellIndex: number | null) => {
    if (cellIndex === null) return 'Move over the map to choose a cell.'
    const cell = state.cells[cellIndex]
    if (!cell) return 'Choose a map cell.'
    if (cell.building || cell.project) return 'This space is already occupied.'
    if (cell.kind === 'water') return 'Cannot build on water.'
    if (cell.kind !== 'open') return 'Choose open ground.'
    if (getProjectIndex(state) >= 0) return 'Finish the current construction first.'
    if (kind === 'hearth' && state.cells.some((candidate) => candidate.building === 'hearth' || candidate.project === 'hearth')) return 'The settlement already has a Hearth.'
    if (kind !== 'hearth' && getHearthIndex(state) < 0) return 'Build the Hearth first.'
    if (kind === 'hearth' && !canPlaceBuilding(state, kind, cellIndex)) return 'The Hearth needs access to water.'
    if (!canAfford(state, kind)) return `Not enough resources for the ${BUILDINGS[kind].label}.`
    return 'Click to place.'
  }, [state])

  const updatePlacementGhost = useCallback((clientX: number, clientY: number) => {
    lastMapPointer.current = { x: clientX, y: clientY }
    const frame = mapFrameRef.current
    if (!placement || !frame) { setPlacementGhost(null); return }
    const frameRect = frame.getBoundingClientRect()
    const element = document.elementFromPoint(clientX, clientY)
    const cellElement = element?.closest<HTMLElement>('[data-cell-index]')
    if (!cellElement) {
      setPlacementGhost(null)
      return
    }
    const parsedIndex = cellElement ? Number(cellElement.dataset.cellIndex) : Number.NaN
    const cellIndex = Number.isInteger(parsedIndex) ? parsedIndex : null
    const cellRect = cellElement?.getBoundingClientRect()
    setPlacementGhost({
      x: cellRect ? cellRect.left + cellRect.width / 2 - frameRect.left : clientX - frameRect.left,
      y: cellRect ? cellRect.top + cellRect.height / 2 - frameRect.top : clientY - frameRect.top,
      size: cellRect ? Math.min(cellRect.width, cellRect.height) : 54,
      cellIndex,
      valid: cellIndex !== null && canAfford(state, placement) && canPlaceBuilding(state, placement, cellIndex),
    })
  }, [placement, state])

  useEffect(() => {
    if (!placement) { setPlacementGhost(null); lastMapPointer.current = null; return }
    const frame = window.requestAnimationFrame(() => {
      const viewport = mapViewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const pointer = lastMapPointer.current ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      updatePlacementGhost(pointer.x, pointer.y)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [placement, mapZoom, updatePlacementGhost])

  useEffect(() => {
    if (!placement) return
    const trackPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') updatePlacementGhost(event.clientX, event.clientY)
    }
    window.addEventListener('pointermove', trackPointer)
    return () => window.removeEventListener('pointermove', trackPointer)
  }, [placement, updatePlacementGhost])

  const cancelPlacement = useCallback(() => { setPlacement(null); setPlacementGhost(null) }, [])

  useEffect(() => {
    const handleWindowKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (placement) cancelPlacement()
        else if (openPanel) setOpenPanel(null)
        else if (selectedCell !== null) setSelectedCell(null)
        return
      }
      const movement = {
        ArrowLeft: { left: -90, top: 0 }, a: { left: -90, top: 0 }, A: { left: -90, top: 0 },
        ArrowRight: { left: 90, top: 0 }, d: { left: 90, top: 0 }, D: { left: 90, top: 0 },
        ArrowUp: { left: 0, top: -90 }, w: { left: 0, top: -90 }, W: { left: 0, top: -90 },
        ArrowDown: { left: 0, top: 90 }, s: { left: 0, top: 90 }, S: { left: 0, top: 90 },
      }[event.key]
      if (movement && mapViewportRef.current) { event.preventDefault(); mapViewportRef.current.scrollBy({ ...movement, behavior: 'smooth' }); return }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault()
        zoomFromCentre(mapZoomRef.current + (event.key === 'PageUp' ? MAP_ZOOM_STEP : -MAP_ZOOM_STEP))
      }
    }
    window.addEventListener('keydown', handleWindowKey)
    return () => window.removeEventListener('keydown', handleWindowKey)
  }, [cancelPlacement, openPanel, placement, selectedCell, zoomFromCentre])

  const handleMapWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.deltaY === 0) return
    setZoomAtPoint(mapZoomRef.current + (event.deltaY < 0 ? MAP_ZOOM_STEP : -MAP_ZOOM_STEP), event.clientX, event.clientY)
    lastMapPointer.current = { x: event.clientX, y: event.clientY }
  }, [setZoomAtPoint])

  useEffect(() => {
    const viewport = mapViewportRef.current
    if (!viewport) return
    viewport.addEventListener('wheel', handleMapWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleMapWheel)
  }, [handleMapWheel])

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    panGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startScrollLeft: viewport.scrollLeft, startScrollTop: viewport.scrollTop, moved: false }
    if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId)
  }

  const handleMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    updatePlacementGhost(event.clientX, event.clientY)
    if (event.pointerType === 'touch') {
      activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId)
      if (activeTouches.current.size === 2) {
        const [first, second] = [...activeTouches.current.values()]
        pinchGesture.current = { startDistance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), startZoom: mapZoomRef.current }
        panGesture.current = null
        setIsPanning(true)
        suppressCellClick.current = true
      } else beginPan(event)
      return
    }
    if (event.button !== 1) return
    event.preventDefault()
    beginPan(event)
  }

  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && activeTouches.current.has(event.pointerId)) {
      activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinchGesture.current && activeTouches.current.size >= 2) {
        const [first, second] = [...activeTouches.current.values()]
        const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
        setZoomAtPoint(pinchGesture.current.startZoom * (distance / pinchGesture.current.startDistance), (first.x + second.x) / 2, (first.y + second.y) / 2)
        suppressCellClick.current = true
        return
      }
    } else updatePlacementGhost(event.clientX, event.clientY)

    const gesture = panGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const deltaX = event.clientX - gesture.startX
    const deltaY = event.clientY - gesture.startY
    if (!gesture.moved && Math.hypot(deltaX, deltaY) > 6) { gesture.moved = true; setIsPanning(true) }
    if (!gesture.moved) return
    event.currentTarget.scrollLeft = gesture.startScrollLeft - deltaX
    event.currentTarget.scrollTop = gesture.startScrollTop - deltaY
  }

  const finishMapPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { activeTouches.current.delete(event.pointerId); if (activeTouches.current.size < 2) pinchGesture.current = null }
    const gesture = panGesture.current
    if (gesture?.pointerId === event.pointerId) { if (gesture.moved) suppressCellClick.current = true; panGesture.current = null }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (activeTouches.current.size === 0) setIsPanning(false)
    window.setTimeout(() => { suppressCellClick.current = false }, 150)
    if (event.pointerType !== 'touch') updatePlacementGhost(event.clientX, event.clientY)
  }

  const handleMapPointerLeave = () => {
    if (panGesture.current || activeTouches.current.size > 0) return
    lastMapPointer.current = null
    setPlacementGhost(null)
  }

  const handleMapScroll = () => {
    const pointer = lastMapPointer.current
    if (pointer && placement) updatePlacementGhost(pointer.x, pointer.y)
  }

  const handleMapContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (placement) cancelPlacement()
    else { setSelectedCell(null); setOpenPanel(null) }
  }

  const selectPlacement = (kind: BuildingKind) => { setPlacement(kind); setBuildPreview(kind); setSelectedCell(null); setOpenPanel(null) }

  const onCellClick = (event: ReactMouseEvent<HTMLButtonElement>, index: number) => {
    if (suppressCellClick.current) {
      suppressCellClick.current = false
      return
    }
    if (placement) {
      const valid = canPlaceBuilding(state, placement, index) && canAfford(state, placement)
      if (valid) {
        const repeatedKind = placement
        dispatch({ type: 'place', building: placement, index })
        setPlacementGhost(null)
        if (event.shiftKey) {
          setPlacement(repeatedKind)
          setSelectedCell(null)
          setOpenPanel(null)
        } else {
          setPlacement(null)
          setSelectedCell(index)
          setOpenPanel('inspect')
        }
      } else dispatch({ type: 'place', building: placement, index })
      return
    }
    setSelectedCell(index)
    setOpenPanel('inspect')
  }

  const resetSettlement = () => {
    dispatch({ type: 'reset' })
    setSelectedCell(null); setPlacement('hearth'); setPlacementGhost(null); setOpenPanel(null); setBuildPreview('hearth'); setShowAgeOne(true)
    mapZoomRef.current = 100; setMapZoom(100)
    window.requestAnimationFrame(centerMap)
  }

  const buildAvailability = (kind: BuildingKind) => {
    if (projectIndex >= 0) return { unavailable: true, reason: 'Finish the current construction first.' }
    if (kind === 'hearth' && getHearthIndex(state) >= 0) return { unavailable: true, reason: 'The Hearth is already built.' }
    if (kind !== 'hearth' && getHearthIndex(state) < 0) return { unavailable: true, reason: 'Build the Hearth first.' }
    if (!canAfford(state, kind)) return { unavailable: true, reason: 'Not enough resources.' }
    return { unavailable: false, reason: 'Ready to place.' }
  }

  const previewDefinition = BUILDINGS[buildPreview]
  const previewAvailability = buildAvailability(buildPreview)
  const placementMessage = placement ? placementReason(placement, placementGhost?.cellIndex ?? null) : ''

  return (
    <main className="age-zero-shell">
      <section className="map-panel" aria-label="Settlement map">
        <div className="map-frame" ref={mapFrameRef}>
          <div
            aria-label="Settlement map viewport. Use the mouse wheel to zoom, middle-drag to move, or use WASD and arrow keys."
            className={`map-scroll${placement ? ' is-placing' : ''}${isPanning ? ' is-panning' : ''}`}
            data-zoom={mapZoom}
            onContextMenu={handleMapContextMenu}
            onPointerCancel={finishMapPointer}
            onPointerDown={handleMapPointerDown}
            onPointerLeave={handleMapPointerLeave}
            onPointerMove={handleMapPointerMove}
            onPointerUp={finishMapPointer}
            onScroll={handleMapScroll}
            ref={mapViewportRef}
            role="region"
            tabIndex={0}
          >
            <div className="grid" role="grid" aria-label="Settlement map" style={{ '--map-scale': mapZoom / 100 } as CSSProperties}>
              {state.cells.map((cell, index) => {
                const villagers = state.assignments[index] ?? 0
                const valid = placement ? canPlaceBuilding(state, placement, index) && canAfford(state, placement) : false
                const depleted = cell.remaining !== undefined && cell.remaining < 18
                const marker = cell.project ? '…' : cell.building ? BUILDINGS[cell.building].shortLabel : CELL_MARK[cell.kind]
                return (
                  <button
                    aria-label={`Row ${Math.floor(index / GRID_SIZE) + 1}, column ${(index % GRID_SIZE) + 1}: ${cellLabels[index]}`}
                    aria-pressed={selectedCell === index}
                    aria-selected={selectedCell === index}
                    className={['cell', `cell-${cell.building || cell.project ? 'building' : cell.kind}`, selectedCell === index ? 'is-selected' : '', placement && valid ? 'is-valid' : '', placement && !valid ? 'is-unavailable' : '', cell.project ? 'is-project' : ''].filter(Boolean).join(' ')}
                    data-cell-index={index}
                    key={index}
                    onClick={(event) => onCellClick(event, index)}
                    role="gridcell"
                    type="button"
                  >
                    <span className="cell-glyph" aria-hidden="true">{marker}</span>
                    {villagers > 0 && <b className="worker-badge" aria-hidden="true">{villagers}</b>}
                    {depleted && <i className="low-resource" aria-hidden="true" />}
                    {cell.project && <i className="project-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, (state.projectProgress / BUILDINGS[cell.project].work) * 100)}%` }} /></i>}
                  </button>
                )
              })}
            </div>
          </div>

          {placement && placementGhost && (
            <div
              aria-hidden="true"
              className={`placement-ghost placement-ghost-${placement}`}
              data-preview-cell={placementGhost.cellIndex ?? undefined}
              data-valid={placementGhost.valid}
              style={{ left: placementGhost.x, top: placementGhost.y, '--ghost-size': `${placementGhost.size}px` } as CSSProperties}
            >
              <span className="ghost-boundary"><b>{BUILDINGS[placement].shortLabel}</b></span>
              <i className="ghost-anchor" />
            </div>
          )}
        </div>
      </section>

      <header className="hud-top">
        <div className="utility-tools utility-tools-left" aria-label="Map utilities">
          <button aria-expanded={openPanel === 'help'} aria-label="Help" className={openPanel === 'help' ? 'is-active' : ''} onClick={() => setOpenPanel((panel) => panel === 'help' ? null : 'help')} type="button">?</button>
          <button aria-label={showLegend ? 'Hide map legend' : 'Show map legend'} aria-pressed={showLegend} className={showLegend ? 'is-active' : ''} onClick={() => setShowLegend((visible) => !visible)} type="button"><span className="layers-symbol" aria-hidden="true" /></button>
        </div>

        <section className="status-cluster" aria-label="Settlement status">
          <button aria-label={`Resources. ${state.stocks.food.toFixed(0)} Food, ${state.stocks.wood.toFixed(0)} Wood, ${state.stocks.stone.toFixed(0)} Stone, ${state.stocks.fiber.toFixed(0)} Fiber.`} className={`status-plaque resources-plaque${reserve < 2 ? ' has-warning' : ''}`} onClick={() => { cancelPlacement(); setSelectedCell(null); setOpenPanel('inspect') }} type="button">
            <span className="plaque-label">RESOURCES</span>
            <span className="resource-values">
              {(['food', 'wood', 'stone', 'fiber'] as const).map((resource) => <span className={`resource-value resource-${resource}`} key={resource} title={RESOURCE_LABEL[resource]}><i aria-hidden="true" /><strong>{state.stocks[resource].toFixed(0)}</strong><small>{RESOURCE_LABEL[resource]}</small></span>)}
            </span>
          </button>

          <button aria-label={`Villagers. ${state.population} total, ${availableWorkers(state)} unassigned, ${shelterCapacity(state)} shelter.`} className="status-plaque villagers-plaque" onClick={() => { cancelPlacement(); setOpenPanel('inspect') }} type="button">
            <span className="plaque-label">VILLAGERS</span>
            <span className="villager-values"><span><strong>{state.population}</strong><small>Villagers</small></span><span><strong>{availableWorkers(state)}</strong><small>Unassigned</small></span><span><strong>{shelterCapacity(state)}</strong><small>Shelter</small></span></span>
          </button>

          <button aria-expanded={openPanel === 'progress'} aria-label={`Progression. Age 0, ${state.population} of ${AGE_ONE_POPULATION} Villagers.`} className={`status-plaque progression-plaque${openPanel === 'progress' ? ' is-active' : ''}`} onClick={() => { cancelPlacement(); setOpenPanel((panel) => panel === 'progress' ? null : 'progress') }} type="button">
            <span className="plaque-label">PROGRESSION</span>
            <span className="progression-values"><strong>Age 0</strong><small>{state.population} / {AGE_ONE_POPULATION}{ageHolding ? ` · ${state.stableDays.toFixed(1)}d` : ''}</small></span>
            <i className="plaque-progress" aria-hidden="true"><span style={{ width: `${progressValue}%` }} /></i>
          </button>
        </section>

        <div className="utility-tools utility-tools-right">
          <button aria-expanded={openPanel === 'settings'} aria-label="Settings" className={openPanel === 'settings' ? 'is-active' : ''} onClick={() => setOpenPanel((panel) => panel === 'settings' ? null : 'settings')} type="button"><span className="settings-symbol" aria-hidden="true" /></button>
        </div>
      </header>

      <section className={`advice-panel${adviceExpanded ? ' is-expanded' : ''}`} aria-labelledby="advice-title">
        <button aria-expanded={adviceExpanded} aria-label="Toggle current advice" className="advice-toggle" onClick={() => setAdviceExpanded((expanded) => !expanded)} type="button"><span className="panel-kicker">ADVICE</span><span aria-hidden="true">{adviceExpanded ? '−' : '+'}</span></button>
        <div className="advice-body">
          <h1 id="advice-title">{goal.title}</h1><p>{goal.detail}</p>
          <div className="advice-progress"><span><strong>AGE 1</strong><b>{state.population} / {AGE_ONE_POPULATION}{ageHolding ? ` · ${state.stableDays.toFixed(1)} / ${AGE_ONE_STABLE_DAYS} days` : ''}</b></span><i aria-label={`${Math.round(progressValue)} percent toward Age 1`}><span style={{ width: `${progressValue}%` }} /></i></div>
        </div>
      </section>

      <section className="time-panel" aria-label="Time controls">
        <div className="speed-controls">
          {([0, 1, 2, 4] as const).map((speed) => <button aria-label={speed === 0 ? 'Pause time' : `Set speed to ${speed} times`} aria-pressed={state.speed === speed} className={state.speed === speed ? 'is-active' : ''} key={speed} onClick={() => dispatch({ type: 'speed', speed })} type="button">{speed === 0 ? 'Ⅱ' : `${speed}×`}</button>)}
        </div>
        <span><strong>Day {state.day}</strong><small>{Math.round(state.dayProgress * 100)}% complete</small></span>
      </section>

      <nav aria-label="Town tools" className="town-tools">
        <button aria-label="Recenter map" onClick={() => { setOpenPanel(null); centerMap() }} type="button"><span className="tool-symbol tool-map-symbol" aria-hidden="true" /><strong>MAP</strong></button>
        <button aria-controls="context-panel" aria-expanded={openPanel === 'inspect'} className={openPanel === 'inspect' ? 'is-active' : ''} onClick={() => { cancelPlacement(); setOpenPanel((panel) => panel === 'inspect' ? null : 'inspect') }} type="button"><span className="tool-symbol tool-work-symbol" aria-hidden="true" /><strong>WORK</strong></button>
        <button aria-controls="build-tray" aria-expanded={openPanel === 'build'} className={openPanel === 'build' ? 'is-active' : ''} onClick={() => { cancelPlacement(); setOpenPanel((panel) => panel === 'build' ? null : 'build') }} type="button"><span className="tool-symbol tool-build-symbol" aria-hidden="true" /><strong>BUILD</strong></button>
      </nav>

      {placement && (
        <section className={`placement-card${placementGhost?.valid ? ' is-valid' : ' is-invalid'}`} aria-live="polite">
          <div className="placement-card-copy"><span className="panel-kicker">PLACING</span><strong>{BUILDINGS[placement].label}</strong><small>{BUILDING_UI[placement].description}</small></div>
          <div className="placement-state"><strong>{placementMessage}</strong><small>{formatUiCost(BUILDINGS[placement].cost)} · Shift-click to keep blueprint</small></div>
          <button aria-label="Cancel placement" onClick={cancelPlacement} type="button">Cancel</button>
        </section>
      )}

      {openPanel === 'build' && (
        <section aria-label="Construction menu" className="build-tray" id="build-tray">
          <header className="tray-heading"><div><span className="panel-kicker">TOWN TOOLS</span><h2>BUILD</h2></div><span>{projectIndex >= 0 ? 'Construction in progress' : 'Choose a building'}</span><button aria-label="Close construction menu" onClick={() => setOpenPanel(null)} type="button">×</button></header>
          <div className="build-browser">
            <div className="building-list">
              {(Object.keys(BUILDINGS) as BuildingKind[]).map((kind) => {
                const definition = BUILDINGS[kind]
                const availability = buildAvailability(kind)
                return <button aria-disabled={availability.unavailable} aria-label={`${definition.label}. ${BUILDING_UI[kind].provides}. Resources needed: ${formatUiCost(definition.cost)}. ${availability.reason}`} className={`${buildPreview === kind ? 'is-previewed' : ''}${availability.unavailable ? ' is-unavailable' : ''}`} key={kind} onClick={() => { if (!availability.unavailable) selectPlacement(kind) }} onFocus={() => setBuildPreview(kind)} onMouseEnter={() => setBuildPreview(kind)} title={availability.reason} type="button"><i className={`building-thumbnail building-${kind}`} aria-hidden="true"><b>{definition.shortLabel}</b></i><span><strong>{definition.label}</strong><small>{BUILDING_UI[kind].provides}</small></span></button>
              })}
            </div>
            <aside className="building-detail" aria-live="polite">
              <div className={`detail-illustration building-${buildPreview}`} aria-hidden="true"><b>{previewDefinition.shortLabel}</b></div>
              <div><span className="panel-kicker">{previewAvailability.unavailable ? 'UNAVAILABLE' : 'READY'}</span><h3>{previewDefinition.label}</h3><p>{BUILDING_UI[buildPreview].description}</p><dl><div><dt>Provides</dt><dd>{BUILDING_UI[buildPreview].provides}</dd></div><div><dt>Resources needed</dt><dd>{formatUiCost(previewDefinition.cost)}</dd></div></dl><strong className={previewAvailability.unavailable ? 'availability-note is-warning' : 'availability-note'}>{previewAvailability.reason}</strong></div>
            </aside>
          </div>
        </section>
      )}

      {openPanel === 'inspect' && (
        <aside aria-label="Settlement work" className="context-panel" id="context-panel">
          <header className="panel-heading-row"><div><span className="panel-kicker">VILLAGE WORK</span><h2>{selected ? CELL_LABEL[selected.kind] : 'Villagers'}</h2></div><button aria-label="Close work panel" onClick={() => setOpenPanel(null)} type="button">×</button></header>
          {projectIndex >= 0 && state.cells[projectIndex].project && (() => {
            const project = state.cells[projectIndex].project!
            const required = BUILDINGS[project].work
            return <section className="context-section construction-section"><div className="section-heading"><h3>{BUILDINGS[project].label} construction</h3><span>{state.projectProgress} / {required}</span></div><p>Assign Builders. Work resolves at the end of each day.</p><div className="assignment-stepper"><button aria-label="Remove one builder" disabled={state.builderWorkers === 0} onClick={() => dispatch({ type: 'builders', workers: state.builderWorkers - 1 })} type="button">−</button><strong><span>{state.builderWorkers}</span> Builders</strong><button aria-label="Add one builder" disabled={availableWorkers(state) === 0 || state.builderWorkers >= 6} onClick={() => dispatch({ type: 'builders', workers: state.builderWorkers + 1 })} type="button">+</button></div></section>
          })()}
          <section className="context-section selection-section">
            {!selected && <><div className="section-heading"><h3>Workforce</h3><span>{availableWorkers(state)} Unassigned</span></div><p>Select a resource cell to assign Villagers, or select a construction site to assign Builders.</p><div className="village-summary"><span><strong>{state.population}</strong> Villagers</span><span><strong>{shelterCapacity(state)}</strong> Shelter</span><span><strong>{reserve.toFixed(1)}</strong> Food days</span></div></>}
            {selected?.project && <p className="selection-message">Construction site: {BUILDINGS[selected.project].label}</p>}
            {selected?.building && <><div className="section-heading"><h3>{BUILDINGS[selected.building].label}</h3><span>Complete</span></div><p>{BUILDING_UI[selected.building].description}</p><dl className="selection-facts"><div><dt>Provides</dt><dd>{BUILDING_UI[selected.building].provides}</dd></div></dl></>}
            {selected && !selected.project && !selected.building && resourceForCell(selected) && <><div className="section-heading"><h3>{CELL_LABEL[selected.kind]}</h3><span>{selected.remaining?.toFixed(0)} remaining</span></div><p>Produces {RESOURCE_LABEL[resourceForCell(selected)!]}.</p><dl className="selection-facts"><div><dt>Distance efficiency</dt><dd>{Math.round(distanceEfficiency(state, selectedCell!) * 100)}%</dd></div><div><dt>Per Villager</dt><dd>{gatheringYield(state, selectedCell!)} / day</dd></div></dl>{getHearthIndex(state) < 0 ? <p className="selection-message">Finish the Hearth before assigning Villagers.</p> : <div className="assignment-stepper"><button aria-label="Remove one Villager" disabled={(state.assignments[selectedCell!] ?? 0) === 0} onClick={() => dispatch({ type: 'resourceWorkers', index: selectedCell!, workers: (state.assignments[selectedCell!] ?? 0) - 1 })} type="button">−</button><strong><span>{state.assignments[selectedCell!] ?? 0}</span> Villagers</strong><button aria-label="Assign one Villager" disabled={availableWorkers(state) === 0 || (state.assignments[selectedCell!] ?? 0) >= 4} onClick={() => dispatch({ type: 'resourceWorkers', index: selectedCell!, workers: (state.assignments[selectedCell!] ?? 0) + 1 })} type="button">+</button></div>}</>}
            {selected && !selected.project && !selected.building && !resourceForCell(selected) && <p className="selection-message">{CELL_LABEL[selected.kind]}. No work can be assigned here.</p>}
          </section>
          <footer className={`latest-event event-${state.event.tone}`} aria-live="polite"><span className="panel-kicker">LATEST</span><p>{state.event.message}</p></footer>
        </aside>
      )}

      {openPanel === 'progress' && (
        <section aria-label="Age 1 progression" className="progress-panel">
          <header className="panel-heading-row"><div><span className="panel-kicker">PROGRESSION</span><h2>AGE 1</h2></div><button aria-label="Close progression panel" onClick={() => setOpenPanel(null)} type="button">×</button></header>
          <dl className="progress-metrics"><div><dt>Population</dt><dd>{state.population} / {AGE_ONE_POPULATION}</dd></div><div><dt>Stable for</dt><dd>{state.stableDays.toFixed(1)} / {AGE_ONE_STABLE_DAYS} days</dd></div><div><dt>Food reserve</dt><dd>{reserve.toFixed(1)} days</dd></div><div><dt>Shelter</dt><dd>{state.population} / {shelterCapacity(state)}</dd></div></dl>
          <div className="large-progress"><span style={{ width: `${progressValue}%` }} /></div>
          {state.population < AGE_ONE_POPULATION ? <ul className="condition-list">{Object.entries(growth.conditions).map(([key, met]) => <li className={met ? 'is-met' : ''} key={key}><span aria-hidden="true">{met ? '✓' : '○'}</span>{conditionLabel(key as keyof typeof growth.conditions)}</li>)}</ul> : <p>Keep all 12 Villagers alive and supplied while the stability meter fills.</p>}
        </section>
      )}

      {openPanel === 'help' && <section aria-label="Help" className="utility-popover help-popover"><header className="panel-heading-row"><h2>Camera controls</h2><button aria-label="Close help" onClick={() => setOpenPanel(null)} type="button">×</button></header><dl><div><dt>Move map</dt><dd>Middle-drag or WASD</dd></div><div><dt>Zoom</dt><dd>Mouse wheel or Page Up / Down</dd></div><div><dt>Select / place</dt><dd>Left click or tap</dd></div><div><dt>Cancel</dt><dd>Right-click or Esc</dd></div><div><dt>Phone / tablet</dt><dd>Drag to move, pinch to zoom</dd></div></dl></section>}

      {openPanel === 'settings' && <section aria-label="Settings menu" className="utility-popover settings-popover"><header className="panel-heading-row"><h2>Settlement menu</h2><button aria-label="Close settings" onClick={() => setOpenPanel(null)} type="button">×</button></header><button className="menu-action" onClick={() => { zoomFromCentre(100); centerMap() }} type="button">Reset camera</button><button className="menu-action is-danger" onClick={resetSettlement} type="button">Start a new settlement</button></section>}

      {showLegend && <section className="map-legend" aria-label="Map legend">{(['water', 'forest', 'food', 'stone', 'fiber'] as const).map((kind) => <span key={kind}><i className={`legend-swatch cell-${kind}`} />{CELL_LABEL[kind]}</span>)}<span><i className="legend-swatch cell-building" />Building</span></section>}
      {state.event.tone === 'warning' && <div className="event-toast" role="alert">{state.event.message}</div>}
      {state.ageOne && showAgeOne && <div className="age-one-backdrop" role="presentation"><section aria-labelledby="age-one-title" aria-modal="true" className="age-one-dialog" role="dialog"><span className="panel-kicker">SETTLEMENT SUSTAINED</span><h2 id="age-one-title">Age 1 has begun</h2><p>Twelve Villagers held the settlement together for five full days. The first camp is now a permanent village.</p><div className="unlock-grid">{['Permanent cottages', 'Granary and farming', 'Gathering sites', 'Paths and better tools'].map((unlock) => <span key={unlock}>{unlock}</span>)}</div><button className="primary-button" onClick={() => setShowAgeOne(false)} type="button">Review the village</button><button className="text-button" onClick={resetSettlement} type="button">Start a new settlement</button></section></div>}
    </main>
  )
}
