import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const url = process.env.GALLERY_URL ?? 'http://127.0.0.1:5188/gallery'
const renders = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renders')
const browser = await chromium.launch({
  args: ['--enable-webgl', '--use-angle=default', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('PAGEERROR', e.message))
await page.goto(url + '?v=polish13', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForFunction(() => window.__galleryState?.ready === true, null, { timeout: 20000 })
await page.waitForTimeout(600)

const shot = async (name) => {
  const p = path.join(renders, name)
  await page.screenshot({ path: p })
  const st = await page.evaluate(() => window.__galleryState)
  console.log('WROTE', name, JSON.stringify(st))
}

const show = async (id, stage) => {
  await page.evaluate(
    ({ id, stage }) => {
      window.__galleryControl?.select(id)
      if (stage) window.__galleryControl?.setStage(stage)
    },
    { id, stage },
  )
  await page.waitForTimeout(700)
}

const orbit = async (yaw) => {
  await page.evaluate((yaw) => window.__galleryControl?.orbit(yaw), yaw)
  await page.waitForTimeout(250)
}

const finished = [
  'home-l1',
  'home-l2',
  'well',
  'stall-a',
  'storehouse',
  'church',
  'notice-board',
  'tree-a',
]
for (const id of finished) {
  await show(id, 'finished')
  await orbit(38)
  await shot(`gallery_${id}_finished.png`)
}

for (const stage of ['pad', 'frame', 'rising']) {
  await show('home-l1', stage)
  await orbit(38)
  await shot(`gallery_home-l1_${stage}.png`)
}

const gableIds = ['home-l1', 'home-l2', 'storehouse', 'church']
for (const id of gableIds) {
  await show(id, 'finished')
  await orbit(8)
  await shot(`gallery_${id}_gable.png`)
  await orbit(98)
  await shot(`gallery_${id}_end.png`)
}

await show('well', 'finished')
await orbit(50)
await shot('gallery_well_finished.png')

await show('tree-a', 'finished')
await orbit(32)
await shot('gallery_tree-a_finished.png')

await browser.close()
console.log('SHOTS DONE')
