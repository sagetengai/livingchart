const ROOT = '/artifacts/cartography/ocean/'

export function createOceanRenderer() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  const images = new Map()
  const load = (slot, url) => {
    if (images.get(slot)?.url !== url) {
      const image = new Image()
      image.src = url
      images.set(slot, { url, ready: image.decode().then(() => image) })
    }
    return images.get(slot).ready
  }

  return async (baseUrl, theme, ocean, isCurrent) => {
    const { depthColor, seafloorRelief, palette } = ocean
    const [base, ramp, relief] = await Promise.all([
      load('base', baseUrl),
      depthColor ? load('ramp', ROOT + `${theme}-${palette}.png`) : null,
      seafloorRelief ? load('relief', ROOT + 'relief.png') : null,
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
    return canvas
  }
}
