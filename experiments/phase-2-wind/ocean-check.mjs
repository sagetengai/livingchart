import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.argv[2])
const output = process.argv[3]
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8092/?phase2=1'
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal'] })

try {
  if (output) await mkdir(output, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.windExperiment?.layer(), null, { timeout: 60000 })

  const studio = page.locator('.wind-studio')
  const ocean = studio.locator('.studio-ocean')
  const depth = ocean.getByLabel('Depth color')
  const relief = ocean.getByLabel('Seafloor relief')
  const palette = ocean.getByLabel('Ocean palette')
  const chartTheme = page.getByLabel('Chart theme')
  const waitForImage = canvas => page.waitForFunction(canvas => {
    const map = window.livingChart.map()
    return map.isSourceLoaded('phase1-bathymetry') &&
      (map.getSource('phase1-bathymetry').image instanceof HTMLCanvasElement) === canvas
  }, canvas)

  const capture = async name => {
    await page.evaluate(() => {
      document.body.classList.add('capture')
      const map = window.livingChart.map()
      window.oceanCheckIdle = false
      map.once('idle', () => { window.oceanCheckIdle = true })
      map.triggerRepaint()
    })
    await page.waitForFunction(() => window.oceanCheckIdle)
    const png = await page.screenshot(output ? { path: join(output, name + '.png') } : {})
    await page.evaluate(() => document.body.classList.remove('capture'))
    return png
  }
  const updates = () => page.evaluate(() => window.oceanCheckUpdates)
  const waitForUpdate = count => page.waitForFunction(count => window.oceanCheckUpdates > count &&
    window.livingChart.map().isSourceLoaded('phase1-bathymetry'), count)
  await page.evaluate(() => {
    const source = window.livingChart.map().getSource('phase1-bathymetry')
    const update = source.updateImage.bind(source)
    window.oceanCheckUpdates = 0
    window.oceanCheckSource = source
    source.updateImage = options => {
      if (options.image) window.oceanCheckUpdates++
      return update(options)
    }
  })
  await studio.locator(':scope > summary').click()
  await ocean.locator('summary').click()
  for (const theme of ['night', 'day']) {
    await chartTheme.selectOption(theme)
    await waitForImage(true)
    await studio.getByRole('checkbox', { name: 'Wind', exact: true }).uncheck()
    await page.waitForFunction(() => !window.windExperiment.layer().enabled)
    await page.evaluate(() => {
      const map = window.livingChart.map()
      map.jumpTo({ center: [-111.25, 25.5], zoom: 8, bearing: 0, pitch: 0 })
    })
    const camera = () => page.evaluate(() => {
      const map = window.livingChart.map()
      return [map.getCenter().toArray(), map.getZoom(), map.getBearing(), map.getPitch()]
    })
    const beforeCamera = await camera()
    await depth.fill('0')
    await relief.fill('0')
    await waitForImage(false)
    const before = await capture('before-' + theme)

    await depth.fill('0.55')
    await waitForImage(true)
    const colored = await capture('depth-' + theme)
    assert.ok(!before.equals(colored))
    const count = await updates()
    await relief.fill('0.4')
    await waitForUpdate(count)
    const shaded = await capture('after-' + theme)
    assert.ok(!colored.equals(shaded))
    assert.deepEqual(await camera(), beforeCamera)
    assert.equal(await palette.inputValue(), theme)
    const paletteCount = await updates()
    await palette.selectOption(theme === 'night' ? 'day' : 'night')
    await waitForUpdate(paletteCount)
    assert.equal(await chartTheme.inputValue(), theme)
    assert.ok(await page.evaluate(() => {
      const map = window.livingChart.map()
      return map.getSource('phase1-bathymetry') === window.oceanCheckSource
    }))
    const bathymetry = studio.getByRole('checkbox', { name: 'Bathymetry', exact: true })
    await bathymetry.uncheck()
    await page.waitForFunction(() => window.livingChart.map().getLayoutProperty('phase1-bathymetry', 'visibility') === 'none')
    await bathymetry.check()
    await page.waitForFunction(() => window.livingChart.map().getLayoutProperty('phase1-bathymetry', 'visibility') === 'visible')
  }
  assert.deepEqual(errors, [])
  console.log('Ocean Studio browser checks passed at 1920×1080.')
} finally {
  await browser.close()
}
