import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { defaults } from './windStudioSettings.js'

const { chromium } = createRequire(import.meta.url)(process.argv[2])
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8092/?phase2=1'
const screenshot = process.argv[3]
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  const forecastRequests = []
  page.on('request', request => {
    if (request.url().includes('/gfs/')) forecastRequests.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.log('Request failed', request.url(), request.failure())
  })
  await page.goto(url)
  await page.waitForFunction(() => window.windExperiment?.snapshot().mode === 'forecast' &&
    window.windExperiment.layer()?.steps > 420, null, { timeout: 60000 })

  const studio = page.locator('.wind-studio')
  await studio.locator(':scope > summary').click()
  const theme = page.getByLabel('Chart theme')
  const tint = studio.getByLabel('Wind tint')
  const apply = studio.getByRole('button', { name: 'Apply', exact: true })
  const setRange = (name, value) => studio.getByLabel(name).fill(String(value))

  const requestsBeforeEdits = forecastRequests.length
  const baseline = await page.evaluate(() => {
    const { map, wind, grid, snapshot } = window.livingChart
    const layer = window.windExperiment.layer()
    map().setBearing(8)
    window.studioBaseline = { map: map(), wind: wind(), grid: grid(), layer, texture: layer.historyTexture }
    const { center, zoom, validTime, frameIndex, sourceLoads } = snapshot()
    return { center, zoom, validTime, frameIndex, sourceLoads, bearing: map().getBearing(), pitch: map().getPitch() }
  })
  async function assertPreserved() {
    const actual = await page.evaluate(() => {
      const { map, wind, grid, snapshot } = window.livingChart
      const layer = window.windExperiment.layer()
      const before = window.studioBaseline
      const { center, zoom, validTime, frameIndex, sourceLoads } = snapshot()
      return {
        identities: [before.map === map(), before.wind === wind(), before.grid === grid(),
          before.layer === layer, before.texture === layer.historyTexture],
        center, zoom, validTime, frameIndex, sourceLoads, bearing: map().getBearing(), pitch: map().getPitch(),
      }
    })
    assert.deepEqual(actual, { ...baseline, identities: [true, true, true, true, true] })
  }

  const ocean = studio.locator('.studio-ocean')
  const oceanPalette = ocean.getByLabel('Ocean palette')
  const oceanSliders = ['Depth color', 'Seafloor relief', 'Current texture', 'Current motion']
  const defaultOceanValues = ['0.55', '0.4', '0.25', '0.3']
  const customOceanValues = ['0.8', '0.65', '0.5', '0.45']
  const oceanValues = () => Promise.all(oceanSliders.map(name => ocean.getByLabel(name).inputValue()))
  const oceanSummary = ocean.locator('summary')
  assert.equal(await ocean.getByLabel('Depth color').isVisible(), false)
  await oceanSummary.click()
  assert.deepEqual(await oceanValues(), defaultOceanValues)
  assert.equal(await oceanPalette.inputValue(), 'night')
  for (const [index, name] of oceanSliders.entries()) {
    await ocean.getByLabel(name).fill(customOceanValues[index])
  }
  await oceanPalette.selectOption('day')
  assert.deepEqual(await oceanValues(), customOceanValues)
  assert.equal(await theme.inputValue(), 'night')
  assert.equal(await page.evaluate(() => window.livingChart.snapshot().palette), 'deep-navy')
  await assertPreserved()
  await oceanSummary.click()

  await tint.fill('#aabbcc')
  await setRange('Trail width', 5)
  await setRange('Trail opacity', 1)
  await setRange('Wind opacity', 0.8)
  await page.waitForFunction(() => {
    const ribbon = window.windExperiment.layer()
    return ribbon.options.width === 5 && ribbon.options.opacity === 1 && Math.abs(ribbon.appearance.opacityMultiplier - 0.896) < 0.0001 &&
      window.livingChart.wind().appearance.rgb[0] === 170 / 255
  })
  await assertPreserved()
  assert.equal(forecastRequests.length, requestsBeforeEdits)

  await page.evaluate(() => window.windExperiment.setPalette('muted-teal'))
  await page.waitForFunction(() => window.livingChart.snapshot().palette === 'muted-teal')
  await studio.getByRole('button', { name: 'Save Preset' }).click()
  await theme.selectOption('day')
  await page.waitForFunction(() => window.livingChart.snapshot().theme === 'day' &&
    window.windExperiment.layer().appearance.rgb[0] === 243 / 255)
  assert.equal(await tint.inputValue(), '#f3f8f5')
  await oceanSummary.click()
  assert.deepEqual(await oceanValues(), defaultOceanValues)
  assert.equal(await oceanPalette.inputValue(), 'day')
  await tint.fill('#ff9900')
  await studio.getByRole('button', { name: 'Save Preset' }).click()
  await assertPreserved()
  await theme.selectOption('night')
  assert.equal(await tint.inputValue(), '#aabbcc')
  assert.deepEqual(await oceanValues(), customOceanValues)
  await ocean.getByRole('button', { name: 'Reset Ocean Defaults' }).click()
  assert.deepEqual(await oceanValues(), defaultOceanValues)
  assert.equal(await oceanPalette.inputValue(), 'night')
  assert.equal(await tint.inputValue(), '#aabbcc')
  await studio.getByRole('button', { name: 'Reset to Defaults' }).click()
  assert.equal(await tint.inputValue(), '#a9d8ea')
  await studio.getByRole('button', { name: 'Load Preset' }).click()
  assert.equal(await tint.inputValue(), '#aabbcc')
  assert.deepEqual(await oceanValues(), customOceanValues)
  assert.equal(await oceanPalette.inputValue(), 'day')
  await oceanSummary.click()

  const download = page.waitForEvent('download')
  await studio.getByRole('button', { name: 'Export JSON' }).click()
  const exported = await readFile(await (await download).path())
  const preset = JSON.parse(exported)
  assert.equal(preset.theme, 'night')
  assert.equal(preset.version, 2)
  assert.equal(preset.palette, 'muted-teal')
  assert.equal(preset.windLayer.width, 5)
  assert.equal(preset.windLayer.opacity, 1)
  assert.equal(preset.windLayer.color, '#aabbcc')
  assert.deepEqual(preset.ocean, {
    depthColor: 0.8, seafloorRelief: 0.65, currentTexture: 0.5, currentMotion: 0.45, palette: 'day',
  })
  preset.windLayer.seedCount = 2400
  preset.windLayer.seed = 42
  const input = studio.getByLabel('Import JSON')
  await input.setInputFiles({ name: 'preset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(preset)) })
  await studio.getByText('Imported the preset.').waitFor()
  assert.equal(await apply.isEnabled(), true)
  await assertPreserved()
  await apply.click()
  await page.waitForFunction(() => {
    const layer = window.windExperiment.layer()
    const before = window.studioBaseline
    return layer === before.layer && layer.options.count === 2400 && layer.seed === 42 &&
      layer.historyTexture !== before.texture && layer.steps >= 420 &&
      layer.readState().filter((generation, index) => index % 4 === 3 && generation > 0).length === 2400
  })
  await theme.selectOption('day')
  await studio.getByRole('button', { name: 'Load Preset' }).click()
  assert.equal(await tint.inputValue(), '#ff9900')
  await input.setInputFiles({ name: 'night.json', mimeType: 'application/json', buffer: exported })
  await studio.getByText('Choose a version 1 or 2 preset for the current Day or Night theme.').waitFor()
  assert.equal(await tint.inputValue(), '#ff9900')
  assert.equal(await apply.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.windExperiment.layer().seed), 42)

  await theme.selectOption('night')
  const legacy = { version: 1, theme: 'night', settings: { ...defaults('night', 20261105), count: 75 } }
  delete legacy.settings.ocean
  await page.evaluate(preset => localStorage.setItem('living-chart.wind-studio.v1.night', JSON.stringify(preset)), legacy)
  await studio.getByRole('button', { name: 'Load Preset' }).click()
  await studio.getByText('Legacy preset count: 75.').waitFor()
  await oceanSummary.click()
  assert.deepEqual(await oceanValues(), defaultOceanValues)
  assert.equal(await oceanPalette.inputValue(), 'night')
  await oceanSummary.click()
  await apply.click()
  await page.waitForFunction(() => window.windExperiment.layer().options.count === 75)

  await studio.getByRole('button', { name: 'Reset to Defaults' }).click()
  await apply.click()
  await studio.getByRole('checkbox', { name: 'Bathymetry', exact: true }).uncheck()
  await studio.getByRole('checkbox', { name: 'Coastline', exact: true }).check()
  await page.waitForFunction(() => {
    const map = window.livingChart.map()
    return map.getLayoutProperty('phase1-bathymetry', 'visibility') === 'none' &&
      map.getLayoutProperty('cortez-coastline', 'visibility') === 'visible'
  })
  await studio.getByRole('button', { name: 'Reset to Defaults' }).click()
  await studio.getByRole('checkbox', { name: 'Show masks' }).check()
  await studio.getByRole('img', { name: 'Regional coastal mask. Blue is water.' }).waitFor()
  await studio.getByRole('checkbox', { name: 'Show masks' }).uncheck()
  await page.waitForFunction(() => window.windExperiment.layer().steps > 420)
  if (screenshot) {
    await studio.locator('.studio-body').evaluate(node => { node.scrollTop = 0 })
    await page.screenshot({ path: screenshot })
  }

  const results = []
  await studio.locator(':scope > summary').click()
  // Benchmark without Studio diagnostics readback, at the same camera and forecast for each count.
  await page.evaluate(() => document.body.classList.add('capture'))
  for (const count of [480, 960, 1920]) {
    await page.evaluate(() => document.body.classList.remove('capture'))
    await studio.locator(':scope > summary').click()
    await setRange('Particle count *', count)
    if (await apply.isEnabled()) await apply.click()
    await studio.locator(':scope > summary').click()
    await page.evaluate(() => document.body.classList.add('capture'))
    await page.waitForFunction(count => {
      const layer = window.windExperiment.layer()
      return layer.options.count === count && layer.steps >= 420 && !layer.pendingSteps
    }, count)
    const sample = await page.evaluate(async count => {
      const layer = window.windExperiment.layer()
      const map = window.livingChart.map()
      const state = layer.readState()
      const spawned = state.filter((generation, index) => index % 4 === 3 && generation > 0).length
      const before = layer.stats.frames
      await new Promise(resolve => setTimeout(resolve, 5000))
      const frames = layer.stats.frames - before
      const intervals = layer.frameTimes.slice(-frames).sort((a, b) => a - b)
      return {
        count, spawned, width: layer.gl.drawingBufferWidth, height: layer.gl.drawingBufferHeight,
        layers: map.getLayersOrder().filter(id => id === 'phase2-wind').length,
        samples: intervals.length,
        fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
        p95Ms: intervals[Math.floor(intervals.length * 0.95)],
        historyKiB: layer.diagnostics().historyBytes / 1024,
        gpu: layer.renderer, forecast: window.windExperiment.snapshot().forecast,
      }
    }, count)
    assert.equal(sample.spawned, count)
    assert.equal(sample.layers, 1)
    assert.ok(sample.samples > 0)
    results.push(sample)
  }
  console.log(JSON.stringify(results, null, 2))
  assert.deepEqual(errors, [])
  console.log('Wind Studio browser checks passed.')
} finally {
  await browser.close()
}
