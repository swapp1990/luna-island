/**
 * This is the locked Phase 1 look; later assets are authored under it.
 *
 * P6-1b retune: the previous sun 0xfff1d0 @ 2.35 + exposure 1.08 + warm vertex
 * colours read khaki (sampled ~132,128,117). Warm sun vs cool sky is still
 * shaping form; the *overall* read is grey.
 *
 * Pinned values:
 *   tone mapping          ACESFilmic
 *   toneMappingExposure   0.98
 *   sun color             0xf2f0ec  intensity 1.38
 *   sun azimuth/elev      208° / 41°
 *   shadow map            2048, PCF soft, bias -0.00035, normalBias 0.04
 *   hemi sky/ground       0xc5cdd6 / 0x949496  intensity 0.78
 *   ambient               0xd0d0d0  intensity 0.42
 *   fog                   FogExp2 0x7e868f  density 0.0032
 *   GTAO radius           0.42 m (world)  scale 1.05  samples 12  blend 0.82
 *   sky turbidity/rayleigh 2.2 / 0.95
 *
 * P6-1c: fill was the hole — shadow-facing props sat at luma ~15 with
 * exposure already correct (white ref 193, nothing clipping). Neutral
 * ambient + a modest hemi bump lift the floor; a small key trim keeps
 * sun-facing facets under ~200. Exposure is unchanged.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { ISLAND_METRES, REF_SPHERE, REF_SPHERE_RADIUS } from './constants'
import { heightAt, type HeightfieldData } from './islandHeight'

export const LOOK = {
  exposure: 0.98,
  sunColor: 0xf2f0ec,
  sunIntensity: 1.38,
  sunAzimuthDeg: 208,
  sunElevationDeg: 41,
  shadowMap: 2048,
  shadowBias: -0.00035,
  shadowNormalBias: 0.04,
  hemiSky: 0xc5cdd6,
  hemiGround: 0x949496,
  hemiIntensity: 0.78,
  ambientColor: 0xd0d0d0,
  ambientIntensity: 0.42,
  fogColor: 0x7e868f,
  fogDensity: 0.0032,
  aoRadius: 0.42,
  aoScale: 1.05,
  aoSamples: 12,
  aoBlend: 0.82,
  skyTurbidity: 2.2,
  skyRayleigh: 0.95,
} as const

export interface LightingHandle {
  sun: THREE.DirectionalLight
  composer: EffectComposer
  refGroup: THREE.Group
  showRefSpheres: (on: boolean) => void
  resize: (w: number, h: number) => void
  render: () => void
  dispose: () => void
}

export function createLighting(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  field: HeightfieldData,
): LightingHandle {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = LOOK.exposure
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

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
  const extent = ISLAND_METRES * 0.62
  sun.shadow.camera.left = -extent
  sun.shadow.camera.right = extent
  sun.shadow.camera.top = extent
  sun.shadow.camera.bottom = -extent
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 180
  sun.shadow.camera.updateProjectionMatrix()

  const az = THREE.MathUtils.degToRad(LOOK.sunAzimuthDeg)
  const el = THREE.MathUtils.degToRad(LOOK.sunElevationDeg)
  const sunDir = new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  )
  sun.position.copy(sunDir).multiplyScalar(90)
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
  gtao.setSceneClipBox(
    new THREE.Box3(new THREE.Vector3(-70, -6, -70), new THREE.Vector3(70, 32, 70)),
  )
  composer.addPass(gtao)
  composer.addPass(new OutputPass())

  const refGroup = new THREE.Group()
  refGroup.visible = false
  const refY = heightAt(field, REF_SPHERE.x, REF_SPHERE.z)
  const midMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace),
    roughness: 0.5,
    metalness: 0,
  })
  const mid = new THREE.Mesh(new THREE.SphereGeometry(REF_SPHERE_RADIUS, 28, 18), midMat)
  mid.position.set(REF_SPHERE.x - 1.35, refY + REF_SPHERE_RADIUS, REF_SPHERE.z)
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
  white.position.set(REF_SPHERE.x + 1.35, refY + REF_SPHERE_RADIUS, REF_SPHERE.z)
  white.castShadow = true
  white.receiveShadow = true
  refGroup.add(mid, white)
  scene.add(refGroup)

  return {
    sun,
    composer,
    refGroup,
    showRefSpheres: (on: boolean) => {
      refGroup.visible = on
    },
    resize: (w: number, h: number) => {
      composer.setSize(w, h)
    },
    render: () => {
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
