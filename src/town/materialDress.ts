/**
 * GLBs shipped with flattened solid albedos and no UVs (glTF dropped the
 * Blender procedural thatch/shingle graphs). Repeating canvas maps + box UVs
 * so roofs read as roofs at inspect distance. Shared on the cached template.
 */
import * as THREE from 'three'
import { seededRng } from './hash'

type Kind = 'thatch' | 'shingle' | 'tile' | 'plank' | 'stone' | 'plaster' | 'leaf' | 'canvas'

const mapCache = new Map<Kind, THREE.CanvasTexture>()
const bumpCache = new Map<Kind, THREE.CanvasTexture>()

function mulberry(seed: number): () => number {
  return seededRng(seed)
}

function canvasTex(
  kind: Kind,
  bump: boolean,
  paint: (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void,
): THREE.CanvasTexture {
  const cache = bump ? bumpCache : mapCache
  const hit = cache.get(kind)
  if (hit) return hit
  const s = 512
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d')
  paint(ctx, s, mulberry(bump ? 0x91a2 : 0x51a7))
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  t.colorSpace = bump ? THREE.NoColorSpace : THREE.SRGBColorSpace
  t.needsUpdate = true
  cache.set(kind, t)
  return t
}

function thatch(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#6E5B44'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 11000; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const len = 12 + rnd() * 26
    const k = rnd()
    const r = 90 + k * 70
    const g = 75 + k * 45
    const b = 42 + k * 28
    ctx.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`
    ctx.lineWidth = 0.7 + rnd() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 5, y + len)
    ctx.stroke()
  }
  // moss patches
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(70,90,50,${0.12 + rnd() * 0.18})`
    ctx.beginPath()
    ctx.ellipse(rnd() * s, rnd() * s, 12 + rnd() * 28, 8 + rnd() * 16, rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // eave-dark bands
  ctx.fillStyle = 'rgba(50,40,28,0.16)'
  for (let y = 0; y < s; y += 36) ctx.fillRect(0, y, s, 5)
}

function shingle(ctx: CanvasRenderingContext2D, s: number, _rnd: () => number): void {
  ctx.fillStyle = '#5C574C'
  ctx.fillRect(0, 0, s, s)
  const rowH = 26
  const colW = 40
  for (let row = 0; row < s / rowH + 2; row++) {
    const off = row % 2 === 0 ? 0 : colW / 2
    for (let col = -1; col < s / colW + 2; col++) {
      const x = col * colW + off
      const y = row * rowH
      const k = Math.abs(row * 17 + col * 9) % 5
      const greys = [
        [122, 116, 102],
        [110, 108, 96],
        [98, 102, 88],
        [130, 122, 108],
        [88, 92, 78],
      ]
      const [r, g, b] = greys[k]!
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.moveTo(x + 2, y + 3)
      ctx.lineTo(x + colW - 3, y + 3)
      ctx.lineTo(x + colW - 5, y + rowH - 2)
      ctx.lineTo(x + 4, y + rowH - 2)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(40,38,32,0.35)'
      ctx.stroke()
    }
  }
}

function tile(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#6E3A2A'
  ctx.fillRect(0, 0, s, s)
  const rowH = 22
  const colW = 36
  for (let row = 0; row < s / rowH + 2; row++) {
    const off = row % 2 === 0 ? 0 : colW / 2
    for (let col = -1; col < s / colW + 2; col++) {
      const x = col * colW + off
      const y = row * rowH
      const r = 120 + ((row + col + (rnd() * 4) | 0) % 6) * 8
      ctx.fillStyle = `rgb(${r},${62 + (col % 4) * 5},${40})`
      ctx.fillRect(x + 1, y + 1, colW - 2, rowH - 2)
    }
  }
}

function plank(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#3A2C20'
  ctx.fillRect(0, 0, s, s)
  const w = 34
  for (let x = 0; x < s; x += w) {
    const shade = 48 + ((x / w + rnd() * 2) % 6) * 7
    ctx.fillStyle = `rgb(${shade + 22},${shade},${shade - 8})`
    ctx.fillRect(x + 1, 0, w - 3, s)
    ctx.fillStyle = 'rgba(20,14,10,0.55)'
    ctx.fillRect(x + w - 2, 0, 2, s)
    for (let n = 0; n < 8; n++) {
      ctx.strokeStyle = `rgba(30,20,12,${0.08 + rnd() * 0.1})`
      ctx.beginPath()
      ctx.moveTo(x + 3 + rnd() * (w - 6), 0)
      ctx.lineTo(x + 3 + rnd() * (w - 6), s)
      ctx.stroke()
    }
  }
}

function stone(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#7A7468'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const rw = 18 + rnd() * 48
    const rh = 12 + rnd() * 26
    const g = 105 + rnd() * 40
    ctx.fillStyle = `rgb(${g - 6},${g - 12},${g - 22})`
    ctx.fillRect(x, y, rw, rh)
    ctx.strokeStyle = 'rgba(40,38,34,0.4)'
    ctx.strokeRect(x, y, rw, rh)
  }
}

function plaster(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#E4DCC8'
  ctx.fillRect(0, 0, s, s)
  const img = ctx.getImageData(0, 0, s, s)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 14
    d[i] = Math.min(255, d[i]! + n)
    d[i + 1] = Math.min(255, d[i + 1]! + n)
    d[i + 2] = Math.min(255, d[i + 2]! + n * 0.75)
  }
  ctx.putImageData(img, 0, 0)
}

function leaf(ctx: CanvasRenderingContext2D, s: number, rnd: () => number): void {
  ctx.fillStyle = '#6A8A48'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = rnd() > 0.45 ? '#7E9A54' : '#4A6A30'
    ctx.beginPath()
    ctx.ellipse(rnd() * s, rnd() * s, 8 + rnd() * 14, 4 + rnd() * 7, rnd() * 6, 0, Math.PI * 2)
    ctx.fill()
  }
}

function canvasStripes(ctx: CanvasRenderingContext2D, s: number, _rnd: () => number): void {
  ctx.fillStyle = '#C9B896'
  ctx.fillRect(0, 0, s, s)
  for (let x = 0; x < s; x += 18) {
    ctx.fillStyle = x % 36 === 0 ? '#9E4B3C' : '#D8CDB4'
    ctx.fillRect(x, 0, 18, s)
  }
}

function bumpFrom(paint: (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void) {
  return (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => {
    paint(ctx, s, rnd)
    const img = ctx.getImageData(0, 0, s, s)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i]! * 0.3 + d[i + 1]! * 0.59 + d[i + 2]! * 0.11) | 0
      d[i] = d[i + 1] = d[i + 2] = y
    }
    ctx.putImageData(img, 0, 0)
  }
}

function kindOf(name: string): Kind | null {
  const n = name.toLowerCase()
  if (n.includes('iron') || n.includes('crank') || n.includes('windlass')) return null
  if (n.includes('thatch')) return 'thatch'
  if (n.includes('shingle')) return 'shingle'
  if (n.includes('roof_tile') || n.includes('rooftile') || (n.includes('roof') && n.includes('tile'))) {
    return 'tile'
  }
  if (n.includes('roof') && !n.includes('soffit')) return 'thatch'
  if (n.includes('plank') || n.includes('timber') || n.includes('oak')) return 'plank'
  if (n.includes('stone') || n.includes('fieldstone')) return 'stone'
  if (n.includes('plaster') || n.includes('whitewash')) return 'plaster'
  if (n.includes('leaf') || n.includes('canopy')) return 'leaf'
  if (n.includes('canvas')) return 'canvas'
  return null
}

const PAINT: Record<Kind, (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void> = {
  thatch,
  shingle,
  tile,
  plank,
  stone,
  plaster,
  leaf,
  canvas: canvasStripes,
}

const UV_SCALE: Record<Kind, number> = {
  thatch: 0.55,
  shingle: 0.48,
  tile: 0.5,
  plank: 0.7,
  stone: 0.45,
  plaster: 0.25,
  leaf: 0.4,
  canvas: 0.8,
}

function ensureUv(geo: THREE.BufferGeometry, scale: number): void {
  if (geo.getAttribute('uv')) {
    // Existing UVs are rare; still scale them if they look like 0–1 only.
    return
  }
  const pos = geo.getAttribute('position')
  if (!pos) return
  const nrm = geo.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    let nx = 0
    let ny = 1
    let nz = 0
    if (nrm) {
      nx = nrm.getX(i)
      ny = nrm.getY(i)
      nz = nrm.getZ(i)
    }
    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x * scale
      uv[i * 2 + 1] = z * scale
    } else if (ax >= az) {
      uv[i * 2] = z * scale
      uv[i * 2 + 1] = y * scale
    } else {
      uv[i * 2] = x * scale
      uv[i * 2 + 1] = y * scale
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

function meshSize(mesh: THREE.Mesh): number {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const b = mesh.geometry.boundingBox
  if (!b) return 1
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z)
}

function dressMat(mat: THREE.Material, kind: Kind): void {
  if (!(mat instanceof THREE.MeshStandardMaterial) && !(mat instanceof THREE.MeshPhysicalMaterial)) return
  mat.metalness = 0
  if (kind === 'thatch' || kind === 'shingle' || kind === 'tile' || kind === 'plaster' || kind === 'plank') {
    mat.side = THREE.DoubleSide
  }
  const map = canvasTex(kind, false, PAINT[kind])
  mat.map = map
  // glTF flattened baseColorFactor is a dark solid; it multiplies the map to black.
  mat.color.setRGB(1, 1, 1)
  if (kind === 'thatch' || kind === 'shingle' || kind === 'plank') {
    mat.bumpMap = canvasTex(kind, true, bumpFrom(PAINT[kind]))
    mat.bumpScale = kind === 'thatch' ? 0.18 : 0.08
  }
  mat.roughness = kind === 'thatch' || kind === 'shingle' || kind === 'leaf' ? 0.94 : mat.roughness
  mat.needsUpdate = true
}

/** Underside of upward roof slopes, slightly inset. Skips hip-end faces (they'd paint over the thatch). */
function addSoffit(mesh: THREE.Mesh): void {
  const parent = mesh.parent
  if (!parent) return
  const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  if (!src || !('clone' in src)) return
  const names = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.name.toLowerCase())
  if (names.some((n) => n.includes('soffit'))) return
  const pos = mesh.geometry.getAttribute('position')
  if (!pos) return
  const idx = mesh.geometry.index
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  mesh.updateWorldMatrix(true, false)
  const mw = mesh.matrixWorld
  const verts: number[] = []
  const pushTri = (i0: number, i1: number, i2: number) => {
    a.fromBufferAttribute(pos, i0).applyMatrix4(mw)
    b.fromBufferAttribute(pos, i1).applyMatrix4(mw)
    c.fromBufferAttribute(pos, i2).applyMatrix4(mw)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    nrm.copy(ab).cross(ac)
    if (nrm.y <= 0.2) return
    nrm.normalize().multiplyScalar(0.05)
    verts.push(
      a.x - nrm.x, a.y - nrm.y, a.z - nrm.z,
      c.x - nrm.x, c.y - nrm.y, c.z - nrm.z,
      b.x - nrm.x, b.y - nrm.y, b.z - nrm.z,
    )
  }
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) pushTri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2))
  } else {
    for (let i = 0; i < pos.count; i += 3) pushTri(i, i + 1, i + 2)
  }
  if (verts.length < 9) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.92, metalness: 0, side: THREE.DoubleSide })
  const under = new THREE.Mesh(geo, mat)
  under.name = 'roof_soffit'
  under.castShadow = false
  under.receiveShadow = true
  rootOf(mesh)?.add(under) ?? parent.add(under)
}

function rootOf(o: THREE.Object3D): THREE.Object3D | null {
  let p: THREE.Object3D | null = o
  while (p.parent && p.parent.type !== 'Scene') p = p.parent
  return p
}

function showGables(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (!o.name.toLowerCase().includes('gable')) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      m.side = THREE.DoubleSide
      m.needsUpdate = true
    }
    o.geometry.computeVertexNormals()
  })
}

const DRESS_HELPER = /^(interior_plug|gable_cap|attic_lid|eave_fascia)$/

/** Rising clip must not reveal the solid attic lid / gable fill as a black slab. */
export function hideDressHelpers(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (DRESS_HELPER.test(o.name)) o.visible = false
  })
}

function addThickTriangle(
  root: THREE.Object3D,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  mat: THREE.Material,
  name: string,
  thickness = 0.1,
): void {
  const n = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(p1, p0),
    new THREE.Vector3().subVectors(p2, p0),
  )
  if (n.lengthSq() < 1e-8) return
  n.normalize().multiplyScalar(thickness * 0.5)
  const a0 = p0.clone().add(n)
  const a1 = p0.clone().sub(n)
  const b0 = p1.clone().add(n)
  const b1 = p1.clone().sub(n)
  const c0 = p2.clone().add(n)
  const c1 = p2.clone().sub(n)
  const pts = [a0, b0, c0, a1, c1, b1, a0, a1, b1, a0, b1, b0, b0, b1, c1, b0, c1, c0, c0, c1, a1, c0, a1, a0]
  const arr = new Float32Array(pts.length * 3)
  for (let i = 0; i < pts.length; i++) {
    arr[i * 3] = pts[i]!.x
    arr[i * 3 + 1] = pts[i]!.y
    arr[i * 3 + 2] = pts[i]!.z
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  geo.computeVertexNormals()
  ensureUv(geo, 0.5)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh)
}

function roofMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const roofs: THREE.Mesh[] = []
  root.traverse((o) => {
    const n = o.name.toLowerCase()
    if (
      o instanceof THREE.Mesh &&
      n.includes('roof') &&
      !n.includes('soffit') &&
      !n.includes('cap') &&
      !n.includes('spire')
    ) {
      roofs.push(o)
    }
  })
  return roofs
}

function ridgeAlongX(roofs: THREE.Mesh[]): boolean {
  const box = new THREE.Box3()
  for (const r of roofs) box.expandByObject(r)
  const yCut = box.min.y + (box.max.y - box.min.y) * 0.78
  const high = new THREE.Box3()
  const v = new THREE.Vector3()
  let any = false
  for (const r of roofs) {
    const pos = r.geometry.getAttribute('position')
    if (!pos) continue
    r.updateWorldMatrix(true, false)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(r.matrixWorld)
      if (v.y >= yCut) {
        high.expandByPoint(v)
        any = true
      }
    }
  }
  if (!any) {
    const size = box.getSize(new THREE.Vector3())
    return size.x >= size.z
  }
  return high.max.x - high.min.x >= high.max.z - high.min.z
}

function wallFillMat(root: THREE.Object3D, gables: THREE.Mesh[]): THREE.MeshStandardMaterial {
  for (const g of gables) {
    const mats = Array.isArray(g.material) ? g.material : [g.material]
    const hit = mats.find((m) => m instanceof THREE.MeshStandardMaterial)
    if (hit instanceof THREE.MeshStandardMaterial) {
      const c = hit.clone()
      c.side = THREE.DoubleSide
      c.needsUpdate = true
      return c
    }
  }
  let found: THREE.MeshStandardMaterial | undefined
  const pick = (re: RegExp) => {
    root.traverse((o) => {
      if (found || !(o instanceof THREE.Mesh)) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const hit = mats.find((m) => re.test(m.name))
      if (hit instanceof THREE.MeshStandardMaterial) found = hit
    })
  }
  pick(/plaster|whitewash/i)
  if (!found) pick(/plank/i)
  if (!found) pick(/timber|oak/i)
  const mat = found
    ? found.clone()
    : new THREE.MeshStandardMaterial({ color: 0xe4dcc8, roughness: 0.9, metalness: 0 })
  mat.side = THREE.DoubleSide
  mat.needsUpdate = true
  return mat
}

function roofProfile(roofs: THREE.Mesh[]): { box: THREE.Box3; eave: number; ridge: number } {
  const box = new THREE.Box3()
  for (const r of roofs) box.expandByObject(r)
  const ys: number[] = []
  const v = new THREE.Vector3()
  for (const r of roofs) {
    const pos = r.geometry.getAttribute('position')
    if (!pos) continue
    r.updateWorldMatrix(true, false)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(r.matrixWorld)
      ys.push(v.y)
    }
  }
  ys.sort((a, b) => a - b)
  const span = box.max.y - box.min.y
  const band = ys.filter((y) => y > box.min.y + 0.12 && y < box.min.y + span * 0.42)
  const eave = band.length ? band[Math.floor(band.length / 2)]! : box.min.y + Math.min(0.35, span * 0.12)
  const ridge = ys.length ? ys[ys.length - 1]! : box.max.y
  return { box, eave, ridge }
}

function wallBox(root: THREE.Object3D): THREE.Box3 | null {
  const box = new THREE.Box3()
  let hit = false
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const n = o.name.toLowerCase()
    if (!/wall|panel/.test(n) || n.includes('gable')) return
    box.expandByObject(o)
    hit = true
  })
  return hit ? box : null
}

function plugAttic(root: THREE.Object3D, roofBox: THREE.Box3, eaveY: number): void {
  const walls = wallBox(root)
  const src = walls ?? roofBox
  const size = src.getSize(new THREE.Vector3())
  if (size.x < 1.2 || size.z < 1.2) return
  const mat = wallFillMat(root, [])
  const t = 0.07
  const cx = (src.min.x + src.max.x) / 2
  const cy = walls ? (src.min.y + src.max.y) / 2 : eaveY / 2
  const cz = (src.min.z + src.max.z) / 2
  const h = walls ? size.y : Math.max(1.2, eaveY)
  const yMid = walls ? cy : h / 2
  const yTop = walls ? src.max.y : eaveY
  const panels: Array<[number, number, number, number, number, number]> = [
    [size.x + t, h, t, cx, yMid, src.min.z],
    [size.x + t, h, t, cx, yMid, src.max.z],
    [t, h, size.z + t, src.min.x, yMid, cz],
    [t, h, size.z + t, src.max.x, yMid, cz],
    [size.x + t, t, size.z + t, cx, yTop, cz],
  ]
  for (const [sx, sy, sz, x, y, z] of panels) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
    mesh.name = 'attic_lid'
    mesh.position.set(x, y, z)
    mesh.castShadow = false
    mesh.receiveShadow = true
    root.add(mesh)
  }
}

function fillGableCaps(root: THREE.Object3D): void {
  const roofs = roofMeshes(root)
  if (roofs.length === 0) return

  const gables: THREE.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name.toLowerCase().includes('gable')) gables.push(o)
  })
  for (const g of gables) g.removeFromParent()

  const { box, eave: profileEave, ridge } = roofProfile(roofs)
  const walls = wallBox(root)
  const eave = Math.min(profileEave, walls ? walls.max.y : profileEave)
  plugAttic(root, box, eave)
  // Hip roofs: ridge stops short of the eaves. A full gable triangle pokes through as a fin.
  if (gables.length === 0) return

  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const mat = wallFillMat(root, gables)
  const alongX = ridgeAlongX(roofs)
  const inset = 0.1

  // Ridge along X ⇒ gable/hip ends at min/max X. Ridge along Z ⇒ ends at Z.
  if (alongX) {
    const x0 = box.min.x + inset
    const x1 = box.max.x - inset
    addThickTriangle(
      root,
      new THREE.Vector3(x0, eave, box.min.z + inset),
      new THREE.Vector3(x0, eave, box.max.z - inset),
      new THREE.Vector3(x0, ridge, cz),
      mat,
      'gable_cap',
    )
    addThickTriangle(
      root,
      new THREE.Vector3(x1, eave, box.min.z + inset),
      new THREE.Vector3(x1, eave, box.max.z - inset),
      new THREE.Vector3(x1, ridge, cz),
      mat,
      'gable_cap',
    )
  } else {
    const z0 = box.min.z + inset
    const z1 = box.max.z - inset
    addThickTriangle(
      root,
      new THREE.Vector3(box.min.x + inset, eave, z0),
      new THREE.Vector3(box.max.x - inset, eave, z0),
      new THREE.Vector3(cx, ridge, z0),
      mat,
      'gable_cap',
    )
    addThickTriangle(
      root,
      new THREE.Vector3(box.min.x + inset, eave, z1),
      new THREE.Vector3(box.max.x - inset, eave, z1),
      new THREE.Vector3(cx, ridge, z1),
      mat,
      'gable_cap',
    )
  }
}

function repairWell(root: THREE.Object3D): void {
  root.traverse((o) => {
    const n = o.name.toLowerCase()
    if (n.includes('crank') || n.includes('windlass')) o.visible = false
  })
  const oak = new THREE.MeshStandardMaterial({ color: 0x5c4a34, roughness: 0.88, metalness: 0 })
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.55, metalness: 0.12 })
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 8), oak)
  roller.name = 'well_roller'
  roller.position.set(0, 1.58, 0)
  roller.rotation.z = Math.PI / 2
  roller.castShadow = true
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.38, 8), iron)
  handle.name = 'well_handle'
  handle.position.set(0.58, 1.48, 0.1)
  handle.rotation.x = Math.PI / 2
  handle.castShadow = true
  root.add(roller, handle)

  const roofs = roofMeshes(root)
  if (roofs.length === 0) return
  const { box, eave, ridge } = roofProfile(roofs)
  const alongX = ridgeAlongX(roofs)
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  const inset = 0.06
  if (alongX) {
    for (const x of [box.min.x + inset, box.max.x - inset]) {
      addThickTriangle(
        root,
        new THREE.Vector3(x, eave, box.min.z + inset),
        new THREE.Vector3(x, eave, box.max.z - inset),
        new THREE.Vector3(x, ridge, cz),
        oak,
        'gable_cap',
        0.06,
      )
    }
  } else {
    for (const z of [box.min.z + inset, box.max.z - inset]) {
      addThickTriangle(
        root,
        new THREE.Vector3(box.min.x + inset, eave, z),
        new THREE.Vector3(box.max.x - inset, eave, z),
        new THREE.Vector3(cx, ridge, z),
        oak,
        'gable_cap',
        0.06,
      )
    }
  }
}

function displaceBlob(geo: THREE.BufferGeometry, rnd: () => number): void {
  const pos = geo.getAttribute('position')
  if (!pos) return
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    pos.setXYZ(i, x * (0.94 + rnd() * 0.1), y * (0.88 + rnd() * 0.14), z * (0.94 + rnd() * 0.1))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
}

function repairTree(root: THREE.Object3D): void {
  const canopies: THREE.Mesh[] = []
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const n = o.name.toLowerCase()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const leafy =
      n.includes('leaf') ||
      n.includes('canopy') ||
      n.includes('blob') ||
      mats.some((m) => /leaf|canopy/i.test(m.name))
    if (!leafy) return
    const count = o.geometry.getAttribute('position')?.count ?? 0
    if (count > 48) return
    canopies.push(o)
  })
  if (canopies.length === 0) return
  const union = new THREE.Box3()
  for (const c of canopies) {
    c.visible = false
    union.expandByObject(c)
  }
  const size = union.getSize(new THREE.Vector3())
  const center = union.getCenter(new THREE.Vector3())
  const r = Math.max(0.45, Math.max(size.x, size.y, size.z) * 0.42)
  const leafMat = new THREE.MeshStandardMaterial({
    map: canvasTex('leaf', false, PAINT.leaf),
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
  })
  const rnd = mulberry(0x51a7)
  const offsets: Array<[number, number, number, number]> = [
    [0, 0.08, 0, 1],
    [0.38, -0.06, 0.22, 0.72],
    [-0.32, -0.04, -0.18, 0.7],
    [0.12, 0.22, -0.28, 0.62],
  ]
  for (const [ox, oy, oz, sc] of offsets) {
    const geo = new THREE.IcosahedronGeometry(r * sc, 2)
    displaceBlob(geo, rnd)
    const mesh = new THREE.Mesh(geo, leafMat)
    mesh.name = 'canopy_blob'
    mesh.position.set(center.x + ox * r, center.y + oy * r, center.z + oz * r)
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
}

function shouldPlug(file: string): boolean {
  const n = file.toLowerCase()
  if (n.includes('well') || n.includes('stall') || n.includes('tree') || n.includes('notice') || n.includes('fixture')) {
    return false
  }
  return true
}

/** Mutates the loaded glTF template in place. */
export function dressLoadedAsset(root: THREE.Object3D, file = ''): void {
  const roofs: THREE.Mesh[] = []
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.castShadow = true
    o.receiveShadow = true
    const all = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of all) {
      m.side = THREE.DoubleSide
      m.needsUpdate = true
    }
    if (meshSize(o) < 0.28) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    let roofish = false
    for (const m of mats) {
      const kind = kindOf(m.name)
      if (!kind) continue
      ensureUv(o.geometry, UV_SCALE[kind])
      dressMat(m, kind)
      if (kind === 'thatch' || kind === 'shingle' || kind === 'tile') roofish = true
    }
    if (roofish) roofs.push(o)
  })
  for (const r of roofs) addSoffit(r)
  showGables(root)
  if (shouldPlug(file)) fillGableCaps(root)
  if (file.toLowerCase().includes('well')) repairWell(root)
  if (file.toLowerCase().includes('tree')) repairTree(root)
}
