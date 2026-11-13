import { dayPalettes, defaultDayPalette, defaultFrame, parseDayFrame } from '../phase-1-geography/dayChart.js'
import { MAX_RIBBON_COUNT, PRESETS } from './HistoryWindLayer.js'

export const palettes = {
  'deep-navy': 'Deep navy',
  'blue-black': 'Blue-black',
  'muted-teal': 'Muted teal',
}

export const windControls = {
  count: ['Particle count', 100, MAX_RIBBON_COUNT, 1],
  history: ['History positions', 16, 192, 1],
  width: ['Trail width (px)', 0.5, 5, 0.01],
  taper: ['Taper strength', 0.3, 2, 0.01],
  opacity: ['Trail opacity', 0, 1, 0.01],
  speed: ['Speed multiplier', 500, 3000, 100],
  lifetime: ['Trail lifetime (s)', 12, 40, 1],
  fade: ['Fade duration (s)', 1, 6, 0.25],
  seed: ['Random seed', 0, 4294967295, 1],
}
export const resourceKeys = ['count', 'history', 'seed']
export const layerNames = ['wind', 'land', 'bathymetry', 'clouds', 'coastline']

export const terrainControls = {
  opacity: ['Relief opacity', 0, 1, 0.01],
  contrast: ['Relief contrast', 0, 2, 0.05],
  shadows: ['Shadow strength', 0, 2, 0.05],
  highlights: ['Highlight strength', 0, 2, 0.05],
}

export const oceanControls = {
  depthColor: ['Depth color', 0, 1, 0.01],
  seafloorRelief: ['Seafloor relief', 0, 1, 0.01],
  currentTexture: ['Current texture', 0, 1, 0.01],
  currentMotion: ['Current motion', 0, 1, 0.01],
}

export const chromaticFlowControls = {
  filamentDensity: ['Filament density', 0, 1, 0.01],
  ribbonProminence: ['Ribbon prominence', 0, 1, 0.01],
  speedColorIntensity: ['Speed color intensity', 0, 1, 0.01],
  gradientOpacity: ['Gradient opacity', 0, 1, 0.01],
  calmAreaVisibility: ['Calm-area visibility', 0, 1, 0.01],
}

export const chromaticFlowDefaults = {
  filamentDensity: 0.70,
  ribbonProminence: 0.35,
  speedColorIntensity: 0.65,
  gradientOpacity: 0.12,
  calmAreaVisibility: 0.25,
}

function parseChromaticFlow(input) {
  if (input === undefined) return undefined
  if (typeof input?.active !== 'boolean') throw new Error('Invalid Chromatic Flow selection.')
  const result = { active: input.active }
  for (const [key, [label, min, max]] of Object.entries(chromaticFlowControls)) {
    const value = input[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label.toLowerCase()}.`)
    result[key] = value
  }
  return result
}

export const oceanPalettes = { day: 'Day', night: 'Night' }

export function oceanDefaults(theme) {
  return {
    depthColor: 0.55,
    seafloorRelief: 0.40,
    currentTexture: 0.25,
    currentMotion: 0.30,
    palette: theme,
  }
}

function parseOcean(ocean, theme) {
  if (ocean === undefined) return oceanDefaults(theme)
  const palette = ocean?.palette
  if (typeof palette !== 'string' || !Object.hasOwn(oceanPalettes, palette)) {
    throw new Error('Invalid ocean palette.')
  }
  const result = { palette }
  for (const [key, [label, min, max]] of Object.entries(oceanControls)) {
    const value = ocean[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label.toLowerCase()}.`)
    result[key] = value
  }
  return result
}

function terrainDefaults(theme) {
  return {
    landColor: theme === 'day' ? null : '#19262e',
    visible: theme === 'night',
    opacity: 0.25,
    contrast: 0.85,
    shadows: 1,
    highlights: 1,
  }
}

function parseTerrain(terrain, theme) {
  if (terrain === undefined) return terrainDefaults(theme)
  if (!terrain || typeof terrain.visible !== 'boolean' ||
    !(typeof terrain.landColor === 'string' && /^#[\da-f]{6}$/i.test(terrain.landColor)) &&
    !(theme === 'day' && terrain.landColor === null)) {
    throw new Error('Invalid terrain color or visibility.')
  }
  const result = { landColor: terrain.landColor, visible: terrain.visible }
  for (const [key, [label, min, max]] of Object.entries(terrainControls)) {
    const value = terrain[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label.toLowerCase()}.`)
    result[key] = value
  }
  return result
}

export function defaults(theme, seed) {
  return {
    ...PRESETS.calligraphic,
    chromaticFlow: undefined,
    terrain: terrainDefaults(theme),
    ocean: oceanDefaults(theme),
    vesselLight: theme === 'night' ? 0.85 : 0.45,
    seed,
    tint: theme === 'day' ? '#F3F8F5' : '#A9D8EA',
    palette: theme === 'day' ? defaultDayPalette : 'deep-navy',
    ...(theme === 'day' && { dayFrame: { ...defaultFrame } }),
    layers: {
      wind: { visible: true, opacity: 1 },
      land: { visible: true, opacity: 1 },
      bathymetry: { visible: true, opacity: 1 },
      clouds: { visible: false, opacity: 0.56 },
      coastline: { visible: false, opacity: 0.72 },
    },
  }
}

const ribbonLayer = {
  id: 'phase2-wind',
  name: 'History ribbons',
  blendMode: 'normal',
  effects: { bloom: false, accumulation: false },
}

/**
 * @typedef {Object} WindLayerConfig
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {number} seedCount
 * @property {number} seed
 * @property {number} history
 * @property {string} color
 * @property {number} opacity
 * @property {number} layerOpacity
 * @property {number} width
 * @property {number} taper
 * @property {number} speed
 * @property {number} lifetime
 * @property {number} fade
 * @property {'normal'} blendMode
 * @property {{ bloom: false, accumulation: false }} effects
 */

export function serializePreset(theme, settings) {
  const { tint, count, palette, terrain, ocean, vesselLight, chromaticFlow, dayFrame, layers: { wind, ...mapLayers }, ...ribbon } = settings
  /** @type {WindLayerConfig} */
  const windLayer = {
    ...ribbonLayer, ...ribbon, enabled: wind.visible, seedCount: count, color: tint, layerOpacity: wind.opacity,
  }
  return JSON.stringify({ version: 2, theme, palette, windLayer, mapLayers, terrain, vesselLight, ocean, chromaticFlow,
    dayFrame: theme === 'day' ? dayFrame : undefined }, null, 2)
}

export function parsePreset(text, theme) {
  const file = JSON.parse(text)
  if (file?.theme !== theme || ![1, 2].includes(file.version)) {
    throw new Error('Choose a version 1 or 2 preset for the current Day or Night theme.')
  }
  let input = file.settings
  if (file.version === 2) {
    const layer = file.windLayer
    if (layer?.id !== ribbonLayer.id || layer.name !== ribbonLayer.name ||
      layer.blendMode !== 'normal' || layer.effects?.bloom !== false || layer.effects?.accumulation !== false ||
      Object.keys(layer.effects).length !== 2) {
      throw new Error('This preview supports History ribbons with normal blending and effects off.')
    }
    input = {
      ...layer, count: layer.seedCount, tint: layer.color, palette: file.palette,
      layers: { ...file.mapLayers, wind: { visible: layer.enabled, opacity: layer.layerOpacity } },
    }
  }
  if (!input) throw new Error('Missing preset settings.')
  const settings = {}
  for (const [key, [label, min, max, step]] of Object.entries(windControls)) {
    const value = input[key]
    if (!Number.isFinite(value) || value < (key === 'count' ? 50 : min) || value > max || (step === 1 && !Number.isInteger(value))) {
      throw new Error(`Invalid ${label.toLowerCase()}.`)
    }
    settings[key] = value
  }
  if (typeof input.tint !== 'string' || !/^#[\da-f]{6}$/i.test(input.tint)) throw new Error('Invalid wind tint.')
  const palette = theme === 'day' && input.palette === 'sculpted-atlas' ? defaultDayPalette : input.palette
  if (!Object.hasOwn(theme === 'day' ? dayPalettes : palettes, palette)) {
    throw new Error('Invalid sea palette.')
  }
  settings.tint = input.tint
  settings.palette = palette
  if (theme === 'day') settings.dayFrame = parseDayFrame(file.version === 2 ? file.dayFrame : input.dayFrame)
  settings.layers = Object.fromEntries(layerNames.map(name => {
    const { visible, opacity } = input.layers?.[name] ?? {}
    if (typeof visible !== 'boolean' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error(`Invalid ${name} layer settings.`)
    }
    return [name, { visible, opacity }]
  }))
  settings.terrain = parseTerrain(file.version === 2 ? file.terrain : input.terrain, theme)
  settings.ocean = parseOcean(file.version === 2 ? file.ocean : input.ocean, theme)
  const vesselLight = file.vesselLight === undefined ? 0 : file.vesselLight
  if (!Number.isFinite(vesselLight) || vesselLight < 0 || vesselLight > 1) {
    throw new Error('Invalid vessel light strength.')
  }
  settings.vesselLight = vesselLight
  settings.chromaticFlow = parseChromaticFlow(file.version === 2 ? file.chromaticFlow : input.chromaticFlow)
  return settings
}
