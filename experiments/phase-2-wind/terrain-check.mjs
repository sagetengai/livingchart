import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.argv[2])
const output = process.argv[3]
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:18195/?phase2=1&audit=1'
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => {
    const map = window.livingChart?.map()
    return window.windExperiment?.snapshot().mode === 'forecast' &&
      window.windExperiment.layer() && map.isSourceLoaded('phase1-land-relief')
  }, null, { timeout: 60000 })

  const studio = page.locator('.wind-studio')
  const terrain = studio.locator('.studio-terrain')
  await studio.locator(':scope > summary').click()
  await terrain.locator('summary').click()
  const visible = terrain.getByLabel('Show land relief')
  const set = (label, value) => terrain.getByLabel(label).fill(String(value))
  const theme = page.getByLabel('Chart theme')
  const paint = (key, value) => page.waitForFunction(([key, value]) =>
    window.livingChart.map().getPaintProperty('phase1-land-relief', key) === value, [key, value])
  const visibility = value => page.waitForFunction(value =>
    window.livingChart.map().getLayoutProperty('phase1-land-relief', 'visibility') === value, value)
  const draw = async seconds => {
    const target = await page.evaluate(seconds => window.windExperiment.advance(seconds), seconds)
    await page.waitForFunction(target => window.windExperiment.layer().steps >= target, target)
  }
  const save = async name => {
    if (!output) return
    await page.evaluate(() => document.body.classList.add('capture'))
    await page.screenshot({ path: join(output, name + '.png') })
    await page.evaluate(() => document.body.classList.remove('capture'))
  }
  if (output) await mkdir(output, { recursive: true })
  await draw(14)
  await page.evaluate(() => {
    const chart = window.livingChart, wind = window.windExperiment.layer(), map = chart.map()
    window.terrainBefore = { wind, original: chart.wind(), grid: chart.grid(), map,
      texture: wind.historyTexture, steps: wind.steps, forecast: chart.snapshot().validTime,
      camera: [map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()] }
  })

  const checkOrder = () => page.waitForFunction(() => {
    const ids = window.livingChart.map().getLayersOrder()
    const i = id => ids.indexOf(id)
    return i('phase1-bathymetry') < i('phase1-land') &&
      i('phase1-land') < i('phase1-land-relief') && i('phase1-land-relief') < i('cortez-wind') &&
      i('cortez-wind') < i('phase2-wind') && i('phase2-wind') < i('cortez-coastline') &&
      ids.filter(id => id.startsWith('goes-cloud-layer-')).every(id => i(id) < i('phase1-land'))
  })
  await checkOrder()
  await visible.uncheck()
  await visibility('none')
  await save('night-relief-off')
  await visible.check()
  await visibility('visible')
  await paint('raster-opacity', 0.25)
  await save('night-relief-subtle')

  const getTone = () => page.evaluate(() => {
    const canvas = window.livingChart.map().getSource('phase1-land-relief').getCanvas()
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let dark = 0, bright = 0
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] < 50) dark += rgba[i + 3]
      else bright += rgba[i + 3]
    }
    return [dark, bright]
  })
  const [dark, bright] = await getTone()
  await set('Shadow strength', 0)
  await page.waitForFunction(async () => {
    const canvas = window.livingChart.map().getSource('phase1-land-relief').getCanvas()
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 50 && data[i + 3] > 10) return false
    }
    return true
  }, null, { polling: 250 })
  await set('Shadow strength', 1.4)
  await set('Highlight strength', 1.5)
  await set('Relief contrast', 1.6)
  await set('Relief opacity', 0.55)
  await paint('raster-opacity', 0.55)
  const [strongDark, strongBright] = await getTone()
  assert.ok(dark > 0 && bright > 0 && strongDark > dark && strongBright > bright)
  await save('night-relief-strong')
  const waterPoints = await page.evaluate(() => {
    const map = window.livingChart.map()
    return [[-109.9, 25.55], [-110.2, 25.75], [-111.15, 25.8], [-113.1, 24.6]].map(coord => {
      const { x, y } = map.project(coord)
      return [Math.round(x), Math.round(y)]
    })
  })
  if (output) await writeFile(join(output, 'water-points.json'), JSON.stringify(waterPoints))

  await terrain.getByLabel('Land base color').fill('#24343f')
  await page.waitForFunction(() =>
    window.livingChart.map().getPaintProperty('phase1-land', 'fill-color') === '#24343f')
  await studio.getByRole('button', { name: 'Save Preset' }).click()
  await theme.selectOption('day')
  await visibility('none')
  await page.waitForFunction(() => {
    const map = window.livingChart.map()
    return map.getSource('phase1-bathymetry').url.endsWith('/day.png') &&
      map.isSourceLoaded('phase1-bathymetry') && map.getPaintProperty('phase1-land', 'fill-opacity') === 0
  })
  await save('day-unchanged')
  await theme.selectOption('night')
  await paint('raster-opacity', 0.55)
  await studio.getByRole('button', { name: 'Reset to Defaults' }).click()
  await paint('raster-opacity', 0.25)
  await studio.getByRole('button', { name: 'Load Preset' }).click()
  await paint('raster-opacity', 0.55)
  assert.equal(await terrain.getByLabel('Land base color').inputValue(), '#24343f')

  const unchanged = await page.evaluate(() => {
    const before = window.terrainBefore, chart = window.livingChart, wind = window.windExperiment.layer(), map = chart.map()
    return before.wind === wind && before.texture === wind.historyTexture && before.steps === wind.steps &&
      before.original === chart.wind() && before.grid === chart.grid() && before.map === map &&
      before.forecast === chart.snapshot().validTime &&
      JSON.stringify(before.camera) === JSON.stringify([map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()])
  })
  assert.ok(unchanged)
  const coordinatesBefore = await page.evaluate(() => {
    const chart = window.livingChart, map = chart.map()
    return map.getSource('phase1-land-relief').coordinates
  })
  await page.evaluate(() => window.livingChart.map().jumpTo({ center: [-111.3, 25.6], zoom: 8.1 }))
  await checkOrder()
  assert.deepEqual(await page.evaluate(() => {
    const map = window.livingChart.map()
    return map.getSource('phase1-land-relief').coordinates
  }), coordinatesBefore)
  await studio.getByLabel('Trail width (px)').fill('3')
  await page.waitForFunction(() => window.windExperiment.layer().options.width === 3)
  assert.deepEqual(errors, [])
  console.log('Terrain browser checks passed.')
} finally {
  await browser.close()
}
