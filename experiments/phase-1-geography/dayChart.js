export const dayPalettes = {
  'admiralty-ivory': { name: 'Admiralty Ivory', ink: '#403a2c', hue: -12, saturation: -0.72, contrast: -0.14, brightness: 0.23 },
  'mediterranean-atlas': { name: 'Mediterranean Atlas', ink: '#233c38', hue: 0, saturation: 0, contrast: 0, brightness: 0 },
  'pacific-survey': { name: 'Pacific Survey', ink: '#1d3746', hue: 16, saturation: -0.18, contrast: 0.11, brightness: 0.07 },
  'heritage-hydrographic': { name: 'Heritage Hydrographic', ink: '#463122', hue: -27, saturation: -0.47, contrast: 0.15, brightness: 0.11 },
}

export const defaultDayPalette = 'mediterranean-atlas'
export const frameModes = { off: 'Off', fixed: 'Fixed screen', geographic: 'Geographic' }
export const frameControls = {
  width: ['Border width (px)', 0.5, 8, 0.5],
  opacity: ['Border opacity', 0, 1, 0.01],
}
export const defaultFrame = { mode: 'fixed', width: 2, opacity: 0.85, ticks: true }

export function parseDayFrame(input) {
  if (input === undefined) return { ...defaultFrame }
  if (!Object.hasOwn(frameModes, input?.mode) || typeof input.ticks !== 'boolean') {
    throw new Error('Invalid Day frame settings.')
  }
  const { mode, width, opacity, ticks } = input
  for (const [key, [label, min, max]] of Object.entries(frameControls)) {
    if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) {
      throw new Error(`Invalid ${label.toLowerCase()}.`)
    }
  }
  return { mode, width, opacity, ticks }
}

export function dayRasterPaint(palette) {
  const { hue, saturation, contrast, brightness } = dayPalettes[palette] ?? dayPalettes[defaultDayPalette]
  return {
    'raster-hue-rotate': hue,
    'raster-saturation': saturation,
    'raster-contrast': contrast,
    'raster-brightness-min': brightness,
  }
}

const lerp = (a, b, fraction) => a.map((value, axis) => value + (b[axis] - value) * fraction)

function coordinate(value, axis) {
  if (axis === 'lng') value = ((value % 360 + 540) % 360) - 180
  const rounded = Number(value.toFixed(2))
  const hemisphere = axis === 'lng' ? (rounded < 0 ? 'W' : 'E') : (rounded < 0 ? 'S' : 'N')
  return `${Math.abs(rounded).toFixed(2)}°${hemisphere}`
}

export function frameGeometry(map, bounds, mode, showTicks) {
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  const inset = Math.min(34, width * 0.08, height * 0.08)
  const [w, s, e, n] = bounds
  const dx = (e - w) * 0.04
  const dy = (n - s) * 0.04
  const geographic = mode === 'geographic'
  const corners = geographic
    ? [[w + dx, n - dy], [e - dx, n - dy], [e - dx, s + dy], [w + dx, s + dy]]
    : [[inset, inset], [width - inset, inset], [width - inset, height - inset], [inset, height - inset]]
  const project = point => {
    if (!geographic) return point
    const { x, y } = map.project(point)
    return [x, y]
  }
  const outline = corners.map(project)
  const ticks = showTicks ? corners.flatMap((start, side) => {
    const end = corners[(side + 1) % 4]
    const [x1, y1] = outline[side]
    const [x2, y2] = outline[(side + 1) % 4]
    const length = Math.hypot(x2 - x1, y2 - y1)
    const divisions = Math.min(10, Math.floor(length / 90))
    const axis = side % 2 === 0 ? 'lng' : 'lat'
    return Array.from({ length: Math.max(0, divisions - 1) }, (_, index) => {
      const point = lerp(start, end, (index + 1) / divisions)
      const [x, y] = project(point)
      const value = geographic ? point[axis === 'lng' ? 0 : 1] : map.unproject(point)[axis]
      return { x, y, dx: (y1 - y2) / length, dy: (x2 - x1) / length, label: coordinate(value, axis) }
    })
  }) : []
  return { outline, ticks }
}
