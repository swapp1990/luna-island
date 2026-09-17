import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createInkLoop, type InkLoop } from './loop'
import { createScene } from './render/scene'
import { Hud } from './ui/Hud'
import './ui/ink.css'

function HudRoot(props: { loop: InkLoop }) {
  const [state, setState] = useState(() => props.loop.getBridge())
  useEffect(() => props.loop.subscribe(() => setState(props.loop.getBridge())), [props.loop])
  return <Hud state={state} control={props.loop.control} />
}

function main(): void {
  const root = document.getElementById('ink-root')
  if (!root) throw new Error('missing #ink-root')
  const params = new URLSearchParams(window.location.search)
  const seed = Number(params.get('seed') ?? 42) || 42

  const shell = document.createElement('div')
  shell.className = 'ink-shell'
  const stage = document.createElement('div')
  stage.className = 'ink-stage'
  const canvas = document.createElement('canvas')
  stage.append(canvas)
  const hudHost = document.createElement('div')
  hudHost.id = 'ink-hud-host'
  hudHost.style.flex = '0 0 300px'
  hudHost.style.width = '300px'
  hudHost.style.height = '100%'
  hudHost.style.minHeight = '0'
  shell.append(stage, hudHost)
  root.append(shell)

  const scene = createScene(canvas, seed)
  const loop = createInkLoop({ canvas, scene, seed })
  createRoot(hudHost).render(<HudRoot loop={loop} />)
  loop.start()
}

main()
