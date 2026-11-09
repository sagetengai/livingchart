import { renderOceanTexture } from './oceanTexture.js'

const ROOT = '/artifacts/cartography/ocean/'
const LAND_MASK = '/artifacts/cartography/day/land.png'
const COASTLINE = '/artifacts/phase-1-geography/coastline.geojson'

export function createOceanRenderer() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  let texture
  const images = new Map()
  const load = (slot, url) => {
    if (images.get(slot)?.url !== url) {
      const image = new Image()
      image.src = url
      images.set(slot, { url, ready: image.decode().then(() => image) })
    }
    return images.get(slot).ready
  }

  return async (baseUrl, theme, ocean, corners, isCurrent) => {
    const { depthColor, seafloorRelief, currentTexture, palette } = ocean
    if (currentTexture && !texture) {
      const coastline = fetch(COASTLINE).then(response => {
        if (!response.ok) throw new Error(`Coastline HTTP ${response.status}`)
        return response.json()
      })
      texture = Promise.all([load('land', LAND_MASK), coastline])
        .then(([land, coast]) => renderOceanTexture(land, coast, corners))
        .catch(error => {
          console.warn('Ocean texture unavailable.', error)
          return null
        })
        .finally(() => images.delete('land'))
    }
    const [base, ramp, relief, pigment] = await Promise.all([
      load('base', baseUrl),
      depthColor ? load('ramp', ROOT + `${theme}-${palette}.png`) : null,
      seafloorRelief ? load('relief', ROOT + 'relief.png') : null,
      currentTexture ? texture : null,
    ])
    if (!isCurrent()) return
    const { naturalWidth: width, naturalHeight: height } = base
    if ([ramp, relief].some(image => image && (image.naturalWidth !== width || image.naturalHeight !== height))) {
      throw new Error('Ocean plates do not match the bathymetry image.')
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    context.globalAlpha = 1
    context.drawImage(base, 0, 0)
    if (ramp) {
      context.globalAlpha = depthColor
      context.drawImage(ramp, 0, 0)
    }
    if (relief) {
      context.globalAlpha = seafloorRelief
      context.drawImage(relief, 0, 0)
    }
    if (pigment && pigment.width === width && pigment.height === height) {
      context.globalAlpha = currentTexture
      context.globalCompositeOperation = 'soft-light'
      context.drawImage(pigment, 0, 0)
      context.globalCompositeOperation = 'source-over'
    }
    return canvas
  }
}
