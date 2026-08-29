/**
 * Town lighting rig — V6 retune toward the manor-slice style bible: low warm
 * sun, cool blue-gray sky fill, pale desaturated sky, horizon haze. Values
 * sampled against `art/manor-slice/renders/ph6c_village.png`. GTAO + PCF
 * shadow machinery is unchanged from the P7-1a neutral rig.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { ISLAND_METRES, REF_SPHERE, REF_SPHERE_RADIUS } from './constants'
import { sunParamsForHour } from './dayNightMath'

export const LOOK = {
  exposure: 1.2,
  /** Bible-warm daytime baseline (before the first updateForTime call). */
  sunColor: 0xf7ecd8,
  sunIntensity: 1.5,
  sunAzimuthDeg: 208,
  sunElevationDeg: 41,
  shadowMap: 2048,
  shadowBias: -0.00035,
  shadowNormalBias: 0.04,
  /** Cool blue-gray fill, per the bible — subtler than the sun so warmth still reads. */
  hemiSky: 0xd7d2c4,
  hemiGround: 0x8f8a7c,
  hemiIntensity: 0.34,
  ambientColor: 0xd8d2c2,
  ambientIntensity: 0.42,
  /** Pale desaturated blue — horizon haze target. */
  fogColor: 0xbdc4c4,
  fogDensity: 0.0034,
  /** God used 0.42 m on a 90 m island; scaled to 144 m. */
  aoRadius: 0.67,
  aoScale: 1.05,
  aoSamples: 12,
  aoBlend: 0.78,
  skyTurbidity: 3.4,
  skyRayleigh: 1.3,
} as const

export interface LightingHandle {
  sun: THREE.DirectionalLight
  composer: EffectComposer
  refGroup: THREE.Group
  showRefSpheres: (on: boolean) => void
  /** V6 day/night: drive sun/sky/fog/ambient from a sim hour-of-day (continuous). */
  updateForTime: (hourFloat: number) => void
  /** Perf-gate readout: `renderer.info.render` since the last frame. */
  rendererInfo: () => { calls: number; triangles: number }
  resize: (w: number, h: number) => void
  render: () => void
  dispose: () => void
}

export function createLighting(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  islandMetres: number = ISLAND_METRES,
): LightingHandle {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = LOOK.exposure
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // EffectComposer runs several internal renderer.render() calls per frame
  // (scene pass, GTAO, output); autoReset would zero renderer.info.render
  // between them, leaving only the last pass's count. Reset once ourselves
  // each frame instead so the perf-gate readout reflects the whole frame.
  renderer.info.autoReset = false

  scene.fog = new THREE.FogExp2(LOOK.fogColor, LOOK.fogDensity)
  scene.background = new THREE.Color(LOOK.fogColor)

  const hemi = new THREE.HemisphereLight(LOOK.hemiSky, LOOK.hemiGround, LOOK.hemiIntensity)
  scene.add(hemi)
  const ambient = new THREE.AmbientLight(LOOK.ambientColor, LOOK.ambientIntensity)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(LOOK.sunColor, LOOK.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(LOOK.shadowMap, LOOK.shadowMap)
  sun.shadow.bias = LOOK.shadowBias
  sun.shadow.normalBias = LOOK.shadowNormalBias
  const extent = islandMetres * 0.62
  sun.shadow.camera.left = -extent
  sun.shadow.camera.right = extent
  sun.shadow.camera.top = extent
  sun.shadow.camera.bottom = -extent
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = islandMetres + extent + 20
  sun.shadow.camera.updateProjectionMatrix()

  const sunDir = new THREE.Vector3()
  const setSunDirFromDeg = (elevationDeg: number, azimuthDeg: number): void => {
    const az = THREE.MathUtils.degToRad(azimuthDeg)
    const el = THREE.MathUtils.degToRad(elevationDeg)
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
  }
  setSunDirFromDeg(LOOK.sunElevationDeg, LOOK.sunAzimuthDeg)
  sun.position.copy(sunDir).multiplyScalar(islandMetres)
  sun.target.position.set(0, 0, 0)
  scene.add(sun)
  scene.add(sun.target)

  const sky = new Sky()
  sky.scale.setScalar(4000)
  const uniforms = sky.material.uniforms
  uniforms['turbidity']!.value = LOOK.skyTurbidity
  uniforms['rayleigh']!.value = LOOK.skyRayleigh
  uniforms['mieCoefficient']!.value = 0.004
  uniforms['mieDirectionalG']!.value = 0.78
  uniforms['sunPosition']!.value.copy(sunDir)
  scene.add(sky)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const gtao = new GTAOPass(scene, camera)
  gtao.output = GTAOPass.OUTPUT.Default
  gtao.blendIntensity = LOOK.aoBlend
  gtao.updateGtaoMaterial({
    radius: LOOK.aoRadius,
    scale: LOOK.aoScale,
    samples: LOOK.aoSamples,
    screenSpaceRadius: false,
    thickness: 1.0,
    distanceExponent: 1.0,
  })
  const clip = islandMetres * 0.62
  gtao.setSceneClipBox(
    new THREE.Box3(new THREE.Vector3(-clip, -8, -clip), new THREE.Vector3(clip, 40, clip)),
  )
  composer.addPass(gtao)
  composer.addPass(new OutputPass())

  const refGroup = new THREE.Group()
  refGroup.visible = false
  const midMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace),
    roughness: 0.5,
    metalness: 0,
  })
  const mid = new THREE.Mesh(new THREE.SphereGeometry(REF_SPHERE_RADIUS, 28, 18), midMat)
  mid.position.set(REF_SPHERE.x - 1.35, REF_SPHERE_RADIUS, REF_SPHERE.z)
  mid.castShadow = true
  mid.receiveShadow = true
  const white = new THREE.Mesh(
    new THREE.SphereGeometry(REF_SPHERE_RADIUS, 28, 18),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.85, 0.85, 0.85, THREE.LinearSRGBColorSpace),
      roughness: 0.5,
      metalness: 0,
    }),
  )
  white.position.set(REF_SPHERE.x + 1.35, REF_SPHERE_RADIUS, REF_SPHERE.z)
  white.castShadow = true
  white.receiveShadow = true
  refGroup.add(mid, white)
  scene.add(refGroup)

  const fogColorTmp = new THREE.Color()
  const updateForTime = (hourFloat: number): void => {
    const p = sunParamsForHour(hourFloat)
    renderer.toneMappingExposure = LOOK.exposure * p.exposureMultiplier
    setSunDirFromDeg(p.elevationDeg, p.azimuthDeg)
    sun.position.copy(sunDir).multiplyScalar(islandMetres)
    sun.intensity = p.sunIntensity
    sun.color.setHex(p.sunColorHex)

    hemi.intensity = p.hemiIntensity
    ambient.intensity = p.ambientIntensity

    fogColorTmp.setHex(p.fogColorHex)
    ;(scene.fog as THREE.FogExp2).color.copy(fogColorTmp)
    if (scene.background instanceof THREE.Color) scene.background.copy(fogColorTmp)

    uniforms['sunPosition']!.value.copy(sunDir)
    // Sky's own atmospheric turbidity/mie handle the dawn/dusk warmth on the
    // dome itself; a low sun still needs a touch more haze to read as "low."
    uniforms['turbidity']!.value = LOOK.skyTurbidity + (1 - p.dayFactor) * 1.5
  }

  return {
    sun,
    composer,
    refGroup,
    showRefSpheres: (on: boolean) => {
      refGroup.visible = on
    },
    updateForTime,
    rendererInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    resize: (w: number, h: number) => {
      composer.setSize(w, h)
    },
    render: () => {
      renderer.info.reset()
      composer.render()
    },
    dispose: () => {
      scene.remove(hemi)
      scene.remove(ambient)
      scene.remove(sun)
      scene.remove(sun.target)
      scene.remove(sky)
      scene.remove(refGroup)
      mid.geometry.dispose()
      white.geometry.dispose()
      ;(mid.material as THREE.Material).dispose()
      ;(white.material as THREE.Material).dispose()
      composer.dispose()
      hemi.dispose()
      ambient.dispose()
      sun.dispose()
      sky.geometry.dispose()
      sky.material.dispose()
    },
  }
}
