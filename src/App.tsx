import { useEffect, useRef, useState } from 'react'
import { Simulation } from './sim/sim'
import { createScene, type SceneHandle } from './render/scene'
import { createLoop, type LoopController } from './loop'
import { initBridge, type SimStateBridge } from './bridge'
import { Hud } from './ui/Hud'
import { Timeline } from './ui/Timeline'

const SEED = 42
const HUD_HZ = 4

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<LoopController | null>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const liveRef = useRef<Simulation | null>(null)

  const [hud, setHud] = useState<SimStateBridge>({
    ready: false,
    mode: 'live',
    day: 1,
    hour: 6,
    minute: 0,
    tick: 0,
    speed: 1,
    agentCount: 0,
    selectedAgentId: null,
    eventCount: 0,
  })
  const [liveHeadTick, setLiveHeadTick] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const live = new Simulation(SEED)
    liveRef.current = live
    const scene = createScene(el, live.state)
    sceneRef.current = scene
    const loop = createLoop(live, scene)
    loopRef.current = loop

    initBridge(
      () => loop.getState(),
      {
        setSpeed: (n) => loop.setSpeed(n),
        pause: () => loop.pause(),
        scrubTo: (t) => loop.scrubTo(t),
        goLive: () => loop.goLive(),
        selectAgent: (id) => loop.selectAgent(id),
      },
    )

    const onResize = () => {
      scene.resize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)
    onResize()

    loop.start()
    setHud(loop.getState())
    setLiveHeadTick(live.state.tick)

    const poll = window.setInterval(() => {
      const s = loop.getState()
      setHud(s)
      setLiveHeadTick(live.state.tick)
    }, 1000 / HUD_HZ)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      loop.stop()
      scene.dispose()
      loopRef.current = null
      sceneRef.current = null
      liveRef.current = null
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        id="scene"
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <Hud
        state={hud}
        onSetSpeed={(n) => {
          loopRef.current?.setSpeed(n)
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
      />
      <Timeline
        state={hud}
        liveHeadTick={liveHeadTick}
        onScrub={(t) => {
          loopRef.current?.scrubTo(t)
          if (loopRef.current) {
            setHud(loopRef.current.getState())
            if (liveRef.current) setLiveHeadTick(liveRef.current.state.tick)
          }
        }}
        onGoLive={() => {
          loopRef.current?.goLive()
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
      />
    </div>
  )
}
