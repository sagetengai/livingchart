// Usage: node integration-audit.mjs /absolute/path/to/installed/playwright
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = createRequire(import.meta.url)(process.argv[2])
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/phase-1-geography')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const result = { testedAt: new Date().toISOString(), errors: [], warnings: [], failedRequests: [], gfsResponses: [], captures: [] }
page.on('pageerror', e => result.errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') result.errors.push(m.text()); if (m.type() === 'warning') result.warnings.push(m.text()) })
page.on('requestfailed', r => result.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }))
page.on('response', r => { if (r.url().includes('/gfs/')) result.gfsResponses.push({ url: r.url(), status: r.status() }) })
const snapshot = () => page.evaluate(() => window.livingChart.snapshot())
async function capture(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`) })
  result.captures.push({ name, time: new Date().toISOString(), state: await snapshot() })
}
async function view(value) {
  await page.evaluate(v => window.livingChart.setView(v), value)
  await page.waitForFunction(v => window.livingChart.snapshot().view === v && window.livingChart.wind().readyForDisplay === (v !== 'geography'), value)
  await page.waitForTimeout(1000)
}
try {
  await page.goto('http://127.0.0.1:8092/?geography=1')
  await page.waitForFunction(() => window.livingChart?.snapshot().mode === 'forecast' && window.livingChart.snapshot().updates > 40, null, { timeout: 60000 })
  await page.waitForTimeout(2000)
  result.initial = await snapshot()
  assert.equal(result.initial.renderer, 'NewParticleMotion')
  assert.equal(result.initial.grid.width, 1440)
  assert.equal(result.initial.grid.height, 721)
  assert(result.initial.activeParticleCount > 0)
  const order = result.initial.layers.map(l => l.id)
  assert(order.indexOf('phase1-bathymetry') < order.indexOf('cortez-wind'))
  assert(order.indexOf('cortez-wind') < order.indexOf('phase1-land'))
  result.gpu = await page.evaluate(() => {
    const gl = window.livingChart.wind().gl, ext = gl.getExtension('WEBGL_debug_renderer_info')
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), error: gl.getError() }
  })
  // Observe one actual transform-feedback update without changing renderer parameters.
  result.vectorCheck = await page.evaluate(() => new Promise(resolve => {
    const api = window.livingChart, wind = api.wind(), update = wind.updateParticles
    wind.updateParticles = function (...args) {
      const buffer = this.currentBuffer, before = api.particles()
      const value = update.apply(this, args)
      if (buffer === this.currentBuffer) return value
      const after = api.particles(); this.updateParticles = update
      const checks = []
      for (const a of before) {
        const b = after[a.index]
        if (!a.sample || b.age !== a.age + 1 || a.sample.speed < 1) continue
        const east = (b.longitude - a.longitude) * Math.cos(a.latitude * Math.PI / 180)
        const north = b.latitude - a.latitude
        if (Math.hypot(east, north) === 0) continue
        const scale = 2.23694 * 1.60934 / 111.32 * wind.velocityFactor
        checks.push({ cosine: (east * a.sample.u + north * a.sample.v) / (Math.hypot(east, north) * a.sample.speed), ratio: Math.hypot(east, north) / (a.sample.speed * scale) })
      }
      const median = values => values.sort((a,b) => a-b)[Math.floor(values.length / 2)]
      resolve({ count: checks.length, directionPositiveFraction: checks.filter(c => c.cosine > 0).length / checks.length,
        medianDirectionCosine: median(checks.map(c => c.cosine)), medianSpeedRatio: median(checks.map(c => c.ratio)),
        note: 'GPU one-step displacement vs CPU nearest-cell U/V; GPU texture filtering and JPEG re-encoding differ slightly. Speed is the existing visual time scale.' })
      return value
    }
  }))
  assert(result.vectorCheck.count > 100)
  assert(result.vectorCheck.directionPositiveFraction > .95)
  assert(Math.abs(result.vectorCheck.medianSpeedRatio - 1) < .2)
  await capture('integrated-preview-1920')
  await page.evaluate(() => document.body.classList.add('capture'))
  await capture('wind-frame-1')
  await page.waitForTimeout(1500)
  await capture('wind-frame-2')
  await page.waitForTimeout(1500)
  await capture('wind-frame-3')
  await view('geography')
  await capture('geography-baseline')
  await page.waitForTimeout(1500)
  await capture('geography-baseline-2')
  await view('original')
  await page.waitForFunction(() => window.livingChart.map().areTilesLoaded(), null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  await capture('original-comparison')
  const original = await snapshot()
  assert.deepEqual(original.center, result.initial.center)
  assert.equal(original.zoom, result.initial.zoom)
  await view('combined')
  for (const palette of ['blue-black', 'muted-teal']) {
    await page.evaluate(p => window.livingChart.setPalette(p), palette)
    await page.waitForTimeout(2000)
    await capture(`integrated-${palette}`)
  }
  await page.evaluate(() => window.livingChart.setPalette('deep-navy'))
  await page.waitForTimeout(2000)
  const beforePan = await snapshot()
  await page.evaluate(() => window.livingChart.map().easeTo({ center: [-110.65, 25.65], zoom: 8.3, duration: 900 }))
  await page.waitForTimeout(2500)
  await capture('wind-after-pan-zoom-1')
  await page.waitForTimeout(1500)
  await capture('wind-after-pan-zoom-2')
  result.afterPan = await snapshot()
  assert(result.afterPan.updates > beforePan.updates + 10)
  assert.notEqual(result.afterPan.zoom, beforePan.zoom)
  const beforeForecast = await snapshot()
  await page.evaluate(() => window.livingChart.nextForecast())
  await page.waitForFunction(previous => {
    const s = window.livingChart.snapshot()
    return s.frameIndex === previous.frameIndex + 1 && s.sourceLoads > previous.sourceLoads && s.mode === 'forecast'
  }, beforeForecast, { timeout: 60000 })
  await page.waitForTimeout(2500)
  await capture('wind-after-forecast-1')
  await page.waitForTimeout(1500)
  await capture('wind-after-forecast-2')
  result.afterForecast = await snapshot()
  assert(result.afterForecast.updates > result.afterPan.updates)
  result.finalGlError = await page.evaluate(() => window.livingChart.wind().gl.getError())
  assert.equal(result.finalGlError, 0)
  assert.equal(result.errors.length, 0)
  result.passed = true
} catch (e) {
  result.passed = false; result.failure = e.stack
  process.exitCode = 1
} finally {
  await browser.close()
  fs.writeFileSync(path.join(output, 'integration-browser-audit.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, failure: result.failure, gpu: result.gpu, vectorCheck: result.vectorCheck, errors: result.errors, warnings: result.warnings, captures: result.captures.length }, null, 2))
}
