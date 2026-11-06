import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = createRequire(import.meta.url)(process.argv[2])
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/phase-1-geography')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const result = { errors: [], delayedGfsMs: 15000 }
page.on('pageerror', e => result.errors.push(e.message))
const state = () => page.evaluate(() => window.livingChart.snapshot())
try {
  await page.route('**/gfs/0p25/wind/*.jpeg', async route => {
    await new Promise(resolve => setTimeout(resolve, result.delayedGfsMs))
    await route.continue()
  })
  await page.goto('http://127.0.0.1:8092/?geography=1')
  await page.waitForFunction(() => window.livingChart?.map()?.getLayer('phase1-bathymetry'))
  result.beforeWind = await state()
  assert(!result.beforeWind.sourceLoaded, 'Geography must arrive before delayed wind')
  await page.waitForFunction(() => window.livingChart?.snapshot().updates > 30, null, { timeout: 60000 })
  result.initial = await state()
  const order = result.initial.layers.map(l => l.id)
  assert(order.indexOf('phase1-bathymetry') < order.indexOf('cortez-wind'))
  await page.getByLabel('Comparison view').selectOption('original')
  await page.waitForTimeout(1000)
  result.original = await state()
  assert.equal(result.original.zoom, result.initial.zoom)
  assert.deepEqual(result.original.center, result.initial.center)
  assert(await page.getByLabel('Bathymetry palette').isDisabled())
  await page.getByLabel('Comparison view').selectOption('geography')
  await page.waitForTimeout(1000)
  result.geography1 = await state()
  await page.waitForTimeout(1000)
  result.geography2 = await state()
  assert.equal(result.geography1.drawCalls, result.geography2.drawCalls)
  await page.getByLabel('Comparison view').selectOption('combined')
  await page.getByLabel('Bathymetry palette').selectOption('muted-teal')
  await page.waitForTimeout(2000)
  result.final = await state()
  assert(result.final.drawCalls > result.geography2.drawCalls)
  assert.equal(result.final.palette, 'muted-teal')
  assert.equal(result.errors.length, 0)
  result.passed = true
} catch (e) { result.failure = e.stack; result.passed = false; process.exitCode = 1 }
finally {
  await browser.close()
  fs.writeFileSync(path.join(output, 'integration-control-audit.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, failure: result.failure, errors: result.errors }))
}
