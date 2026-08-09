import * as THREE from 'three'
import type { SimTime, WorldState } from '../sim/types'

export interface DayNightHandle {
  update: (time: SimTime) => void
  dispose: () => void
}

interface SkyKey {
  hour: number
  color: THREE.Color
}

function parseHex(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

const SKY_KEYS: SkyKey[] = [
  { hour: 0, color: parseHex('#0b1026') },
  { hour: 5, color: parseHex('#1a2340') },
  { hour: 6.5, color: parseHex('#f2b28a') },
  { hour: 9, color: parseHex('#9ed3ff') },
  { hour: 16, color: parseHex('#9ed3ff') },
  { hour: 19.5, color: parseHex('#ff9a5c') },
  { hour: 21, color: parseHex('#14183a') },
  { hour: 24, color: parseHex('#0b1026') },
]

function lerpSky(hour: number): THREE.Color {
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i]!
    const b = SKY_KEYS[i + 1]!
    if (h >= a.hour && h <= b.hour) {
      const t = (h - a.hour) / (b.hour - a.hour || 1)
      return a.color.clone().lerp(b.color, t)
    }
  }
  return SKY_KEYS[0]!.color.clone()
}

function sunElevation(hour: number): number {
  // elevation = sin(π * (t - 6) / 14) for t∈[6,20], else below horizon
  if (hour < 6 || hour > 20) return 0
  return Math.sin((Math.PI * (hour - 6)) / 14)
}

function lightsOn(hour: number): boolean {
  // 18:30–23:00 and 05:00–06:30
  if (hour >= 18.5 && hour < 23) return true
  if (hour >= 5 && hour < 6.5) return true
  return false
}

export function createDayNight(scene: THREE.Scene, world: WorldState): DayNightHandle {
  const hemi = new THREE.HemisphereLight(0xb1d0ff, 0x3a2a1a, 0.9)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 120
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40
  sun.shadow.bias = -0.0005
  scene.add(sun)
  scene.add(sun.target)

  const moon = new THREE.DirectionalLight(0x6f86c9, 0.25)
  moon.castShadow = false
  scene.add(moon)
  scene.add(moon.target)

  const cx = world.width / 2
  const cz = world.height / 2
  sun.target.position.set(cx, 0, cz)
  moon.target.position.set(cx, 0, cz)

  const homeLights: THREE.PointLight[] = []
  for (const place of world.places) {
    if (place.kind !== 'home') continue
    const pl = new THREE.PointLight(0xffb066, 0, 6, 2)
    pl.position.set(place.x, 0.7, place.y)
    pl.castShadow = false
    scene.add(pl)
    homeLights.push(pl)
  }

  const update = (time: SimTime) => {
    const hour = time.hour + time.minute / 60
    const elev = sunElevation(hour)

    // Sun orbit: east→west over the day
    const dayT = hour < 6 ? 0 : hour > 20 ? 1 : (hour - 6) / 14
    const angle = dayT * Math.PI // 0 = sunrise east-ish, π = sunset
    const radius = 55
    const sunX = cx + Math.cos(angle) * radius
    const sunY = 8 + elev * 42
    const sunZ = cz + Math.sin(angle) * radius * 0.35
    sun.position.set(sunX, Math.max(sunY, 2), sunZ)
    sun.intensity = elev * 1.6
    sun.color.set(0xfff4e0)
    sun.visible = elev > 0.001

    // Moon opposite-ish
    moon.position.set(cx - Math.cos(angle) * 40, 30, cz - Math.sin(angle) * 20)
    moon.intensity = elev < 0.05 ? 0.25 : 0
    moon.visible = moon.intensity > 0

    hemi.intensity = 0.25 + elev * 0.65

    const sky = lerpSky(hour)
    scene.background = sky
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(sky)
    }

    const on = lightsOn(hour)
    for (const pl of homeLights) {
      pl.intensity = on ? 1.2 : 0
    }
  }

  const dispose = () => {
    scene.remove(hemi)
    scene.remove(sun)
    scene.remove(sun.target)
    scene.remove(moon)
    scene.remove(moon.target)
    for (const pl of homeLights) scene.remove(pl)
  }

  return { update, dispose }
}
