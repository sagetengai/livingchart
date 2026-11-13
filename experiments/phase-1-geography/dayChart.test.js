import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayPalettes, dayRasterPaint, defaultDayPalette, defaultFrame, frameGeometry } from './dayChart.js'
import { defaults, parsePreset, serializePreset } from '../phase-2-wind/windStudioSettings.js'

test('Day palettes and frame controls round-trip through Studio presets', () => {
  const dayFrame = { mode: 'geographic', width: 4, opacity: 0.55, ticks: false }
  for (const palette of Object.keys(dayPalettes)) {
    const settings = { ...defaults('day', 123), dayFrame, palette }
    const json = JSON.parse(serializePreset('day', settings))
    assert.equal(json.windLayer.dayFrame, undefined)
    assert.deepEqual(parsePreset(JSON.stringify(json), 'day'), settings)
  }
  assert.equal(new Set(Object.keys(dayPalettes).map(palette => JSON.stringify(dayRasterPaint(palette)))).size, 4)
  assert.deepEqual(dayRasterPaint(null), dayRasterPaint(defaultDayPalette))
})

test('legacy Day presets retain the baked palette and receive frame defaults', () => {
  const legacy = defaults('day', 123)
  delete legacy.dayFrame
  legacy.palette = 'sculpted-atlas'
  for (const json of [serializePreset('day', legacy), JSON.stringify({ version: 1, theme: 'day', settings: legacy })]) {
    const result = parsePreset(json, 'day')
    assert.equal(result.palette, defaultDayPalette)
    assert.deepEqual(result.dayFrame, defaultFrame)
  }
})

test('invalid Day frames and palettes fail validation and Night presets retain their schema', () => {
  const settings = defaults('day', 123)
  for (const invalid of [{ mode: 'unknown' }, { width: -1 }, { opacity: 2 }, { ticks: 'true' }]) {
    const json = serializePreset('day', { ...settings, dayFrame: { ...defaultFrame, ...invalid } })
    assert.throws(() => parsePreset(json, 'day'), /Invalid/)
  }
  assert.throws(() => parsePreset(serializePreset('day', { ...settings, palette: 'deep-navy' }), 'day'), /Invalid sea palette/)
  const night = defaults('night', 123)
  const json = serializePreset('night', night)
  assert.equal(JSON.parse(json).dayFrame, undefined)
  assert.deepEqual(parsePreset(json, 'night'), night)
})

test('fixed border holds position while geographic border and coordinates follow the camera', () => {
  let offset = 0
  let width = 1000
  const map = {
    getContainer: () => ({ clientWidth: width, clientHeight: 800 }),
    project: ([lng, lat]) => ({ x: (lng + 115) * 120 + offset, y: (28 - lat) * 120 }),
    unproject: ([x, y]) => ({ lng: (x - offset) / 120 - 115, lat: 28 - y / 120 }),
  }
  const bounds = [-114, 24, -108, 27]
  const fixed = frameGeometry(map, bounds, 'fixed', true)
  const geographic = frameGeometry(map, bounds, 'geographic', true)
  assert.ok(fixed.ticks.length > 0 && geographic.ticks.length > 0)
  assert.match(geographic.ticks[0].label, /°W$/)
  assert.ok(geographic.ticks.some(tick => tick.label.endsWith('°N')))
  offset = 100
  const movedFixed = frameGeometry(map, bounds, 'fixed', true)
  const movedGeographic = frameGeometry(map, bounds, 'geographic', true)
  assert.deepEqual(movedFixed.outline, fixed.outline)
  assert.notEqual(movedFixed.ticks[0].label, fixed.ticks[0].label)
  assert.equal(movedGeographic.outline[0][0], geographic.outline[0][0] + 100)
  assert.equal(movedGeographic.ticks[0].label, geographic.ticks[0].label)
  width = 800
  const resized = frameGeometry(map, bounds, 'fixed', false)
  assert.notDeepEqual(resized.outline, fixed.outline)
  assert.deepEqual(resized.ticks, [])
})
