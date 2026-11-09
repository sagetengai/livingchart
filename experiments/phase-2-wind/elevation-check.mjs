import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.argv[2])
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:18197/?phase2=1&audit=1'
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  const forecastRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.url().includes('/gfs/')) forecastRequests.push(request.url())
  })
  await page.goto(url)
  await page.waitForFunction(() => window.windExperiment?.snapshot().mode === 'forecast' &&
    window.windExperiment.layer() && window.livingChart.map().getLayer('phase1-land-relief'),
  null, { timeout: 60000 })
  const frames = forecastRequests.length
  const studio = page.locator('.wind-studio')
  await studio.locator(':scope > summary').click()
  const elevation = studio.locator('details').filter({ hasText: 'Elevation Data' })
  await elevation.locator('summary').click()
  await elevation.getByRole('button', { name: 'Preview region and estimate' }).click()
  await page.waitForFunction(() => window.livingChart.map().getLayer('studio-elevation-selection'))
  await elevation.getByText('1/1 tiles cached.', { exact: false }).waitFor()
  await elevation.getByRole('button', { name: 'Download elevation data' }).click()
  await elevation.getByText('ready · 1/1 tiles · 1 reused').waitFor({ timeout: 60000 })

  await page.evaluate(() => window.livingChart.map().jumpTo({ center: [-111.15, 24.4], zoom: 8.5 }))
  const target = await page.evaluate(() => window.windExperiment.advance(14))
  await page.waitForFunction(target => window.windExperiment.layer().steps >= target, target)
  await page.evaluate(() => {
    const chart = window.livingChart, wind = window.windExperiment.layer(), map = chart.map()
    window.elevationBefore = { map, wind, original: chart.wind(), grid: chart.grid(), texture: wind.historyTexture,
      validTime: chart.snapshot().validTime, steps: wind.steps,
      camera: [map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()] }
  })
  await elevation.getByRole('button', { name: 'Apply to Preview' }).click()
  await page.waitForFunction(() => {
    const map = window.livingChart.map(), ids = map.getLayersOrder()
    const regional = ids.indexOf('studio-regional-relief')
    return regional > ids.indexOf('phase1-land') && regional < ids.indexOf('phase2-wind') &&
      ids.filter(id => id === 'studio-regional-relief').length === 1 &&
      map.getLayoutProperty('phase1-land-relief', 'visibility') === 'visible'
  })
  assert.deepEqual(await page.evaluate(() => window.livingChart.map().getSource('studio-regional-relief').coordinates),
    [[-111.6, 24.8], [-110.7, 24.8], [-110.7, 24], [-111.6, 24]])
  if (process.argv[3]) {
    await elevation.locator('summary').evaluate(node => node.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: process.argv[3] })
  }

  await page.getByLabel('Chart theme').selectOption('day')
  await page.waitForFunction(() => window.livingChart.snapshot().theme === 'day' &&
    window.livingChart.map().getLayoutProperty('studio-regional-relief', 'visibility') === 'none')
  await page.getByLabel('Chart theme').selectOption('night')
  await page.waitForFunction(() =>
    window.livingChart.map().getLayoutProperty('studio-regional-relief', 'visibility') === 'visible')

  assert.ok(await page.evaluate(() => {
    const before = window.elevationBefore, chart = window.livingChart, wind = window.windExperiment.layer(), map = chart.map()
    return before.map === map && before.wind === wind && before.original === chart.wind() &&
      before.grid === chart.grid() && before.steps === wind.steps && before.texture === wind.historyTexture && before.validTime === chart.snapshot().validTime &&
      JSON.stringify(before.camera) === JSON.stringify([map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()])
  }))
  assert.equal(forecastRequests.length, frames)
  await elevation.getByRole('button', { name: 'Restore original terrain' }).click()
  await page.waitForFunction(() => {
    const map = window.livingChart.map()
    return !map.getLayer('studio-regional-relief') &&
      map.getLayoutProperty('phase1-land-relief', 'visibility') === 'visible'
  })
  assert.deepEqual(errors, [])
  console.log('OpenTopography browser checks passed.')
} finally {
  await browser.close()
}
