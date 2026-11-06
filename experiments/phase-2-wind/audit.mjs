import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PRESETS } from './HistoryWindLayer.js'

const { chromium } = createRequire(import.meta.url)(process.argv[2])
const output = new URL('../../artifacts/phase-2-wind/', import.meta.url)
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:8092/?phase2=1'
const launch = () => chromium.launch(process.env.NATIVE
  ? { channel: 'chrome', args: ['--use-angle=metal'] } : {})
let browser
const report = { captures: [], performance: [], messages: [], forecasts: [] }
let forecast = process.env.FORECAST

await mkdir(output, { recursive: true })
async function open(width, height, dpr, audit) {
  browser = await launch()
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr })
  const profile = { width, height, dpr, audit }
  page.on('pageerror', error => report.messages.push({ profile, type: 'pageerror', text: error.message }))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) report.messages.push({ profile, type: message.type(), text: message.text() })
  })
  page.on('response', response => {
    if (response.url().includes('/gfs/') && response.url().endsWith('.jpeg')) {
      report.forecasts.push({ url: response.url(), status: response.status() })
    }
  })
  const url = new URL(base)
  url.searchParams.set('seed', '20261105')
  if (audit) url.searchParams.set('audit', '1')
  if (forecast) url.searchParams.set('forecast', forecast)
  await page.goto(url.href)
  await page.waitForFunction(() => {
    const snapshot = window.windExperiment?.snapshot()
    return snapshot?.experiment && snapshot.mode === 'forecast' &&
      window.livingChart.map().isSourceLoaded('phase1-bathymetry')
  }, null, { timeout: 60000 })
  const validTime = await page.evaluate(() => window.windExperiment.snapshot().forecast)
  forecast ??= validTime
  assert.equal(validTime, Number(forecast))
  await page.evaluate(() => document.body.classList.add('capture'))
  return page
}

async function advance(page, seconds, original = false) {
  const target = await page.evaluate(seconds => window.windExperiment.advance(seconds), seconds)
  await page.waitForFunction(({ target, original }) => {
    const state = window.windExperiment.snapshot()
    return (original ? state.original : state.experiment).steps >= target
  }, { target, original }, { timeout: 60000 })
}

async function capture(page, name) {
  await page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)) })
  const { experiment, original, baseline } = await page.evaluate(() => window.windExperiment.snapshot())
  report.captures.push({ name, experiment, original, camera: { center: baseline.center, zoom: baseline.zoom }, forecast })
  console.log(name)
}

try {
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
    const page = await open(width, height, 1, true)
    for (const treatment of ['original', 'fine', 'calligraphic', 'atmospheric']) {
      const original = treatment === 'original'
      await page.evaluate(({ original, treatment }) => {
        const api = window.windExperiment
        api.setRenderer(original ? 'original' : 'experimental')
        if (!original) api.setPreset(treatment)
      }, { original, treatment })
      await page.waitForFunction(({ original, treatment, count }) => {
        const { baseline, preset, experiment } = window.windExperiment.snapshot()
        return baseline.ready === original && window.windExperiment.layer().enabled !== original &&
          (original || (preset === treatment && experiment.options.count === count))
      }, { original, treatment, count: PRESETS[treatment]?.count })
      await page.evaluate(() => window.windExperiment.reset())
      await advance(page, 14, original)
      await capture(page, `${treatment}-${width}-a`)
      await advance(page, 1, original)
      await capture(page, `${treatment}-${width}-b`)
    }
    if (width === 1920) {
      await page.evaluate(() => window.livingChart.map().jumpTo({ center: [-110.65, 25.65], zoom: 8.3 }))
      await advance(page, 3)
      await capture(page, 'pan-zoom-1920-a')
      await advance(page, 1)
      await capture(page, 'pan-zoom-1920-b')
      const before = await page.evaluate(() => window.windExperiment.layer().readState())
      await advance(page, 1 / 30)
      const after = await page.evaluate(() => window.windExperiment.layer().readState())
      // Run the production CPU decoder in the browser against the same uploaded grid.
      const check = await page.evaluate(async ({ before, after }) => {
        const { sampleWind } = await import('/src/windData.js')
        const grid = window.livingChart.grid()
        const cosines = [], ratios = []
        for (let i = 0; i < before.length; i += 4) {
          const lat = 90 - before[i + 1] * 180
          if (before[i + 2] <= 0 || after[i + 2] <= 0 || before[i + 3] !== after[i + 3]) continue
          const wind = sampleWind(grid, before[i] * 360 - 180, lat)
          if (!wind || wind.speed < 1) continue
          const east = (after[i] - before[i]) * 360 * Math.cos(lat * Math.PI / 180)
          const north = (before[i + 1] - after[i + 1]) * 180
          const distance = Math.hypot(east, north)
          if (!distance) continue
          cosines.push((east * wind.u + north * wind.v) / (distance * wind.speed))
          ratios.push(distance * 111320 * 30 / (wind.speed * window.windExperiment.layer().options.speed))
        }
        const median = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
        return { samples: cosines.length, medianDirectionCosine: median(cosines), medianSpeedRatio: median(ratios) }
      }, { before, after })
      report.vectorCheck = check
      assert(check.samples > 30 && check.medianDirectionCosine > 0.95 && Math.abs(check.medianSpeedRatio - 1) < 0.15)
    }
    await browser.close()
  }
  for (const [width, height, dpr] of [[1920, 1080, 1], [3840, 2160, 1], [1920, 1080, 2]]) {
    const page = await open(width, height, dpr, false)
    await page.waitForFunction(() => window.windExperiment.layer().frameTimes.length >= 10, null, { timeout: 60000 })
    const { initial, final, interaction } = await page.evaluate(async () => {
      const layer = window.windExperiment.layer()
      const map = window.livingChart.map()
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      layer.frameTimes.length = layer.cpuTimes.length = layer.gpuTimes.length = 0
      const initial = layer.diagnostics()
      await wait(4000)
      const final = layer.diagnostics()
      layer.frameTimes.length = 0
      map.easeTo({ center: [-110.65, 25.65], zoom: map.getZoom() + 0.4, duration: 1000 })
      await wait(1000)
      return { initial, final, interaction: layer.diagnostics() }
    })
    report.performance.push({ width, height, dpr, final, interaction, draws: final.draws - initial.draws, updates: final.updates - initial.updates })
    console.log(width, height, dpr, final.renderer, final.frameMs)
    await browser.close()
  }
  assert(!report.messages.some(message => message.type === 'pageerror' || /INVALID_(OPERATION|ENUM|VALUE)|framebuffer.*feedback/i.test(message.text)))
} finally {
  await writeFile(new URL(process.env.NATIVE ? 'native.json' : 'audit.json', output), JSON.stringify(report, null, 2))
  await browser?.close()
}
