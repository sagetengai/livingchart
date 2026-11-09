import { MercatorCoordinate } from 'maplibre-gl'

const RELIEF_URL = '/artifacts/cartography/terrain/land-relief.png'

export async function loadLandRelief(url = RELIEF_URL) {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const source = context.getImageData(0, 0, canvas.width, canvas.height).data
  const output = context.createImageData(canvas.width, canvas.height)

  return {
    canvas,
    recolor({ contrast, shadows, highlights }, chart, region) {
      const colors = new Uint8ClampedArray(256 * 4)
      for (let value = 0; value < 256; value++) {
        const tone = (value - 128) / 127
        const shade = tone < 0
        colors.set(shade ? [5, 12, 25] : [151, 169, 178], value * 4)
        colors[value * 4 + 3] = 255 * Math.min(1, Math.abs(tone) * contrast * (shade ? shadows : highlights))
      }
      for (let i = 0; i < source.length; i += 4) {
        if (!source[i + 3]) continue
        const color = source[i] * 4
        output.data[i] = colors[color]
        output.data[i + 1] = colors[color + 1]
        output.data[i + 2] = colors[color + 2]
        output.data[i + 3] = colors[color + 3] * source[i + 3] / 255
      }
      context.putImageData(output, 0, 0)
      if (region) {
        const [chartNW, chartSE, regionNW, regionSE] = [chart[0], chart[2], region[0], region[2]]
          .map(coordinate => MercatorCoordinate.fromLngLat(coordinate))
        const scaleX = canvas.width / (chartSE.x - chartNW.x)
        const scaleY = canvas.height / (chartSE.y - chartNW.y)
        context.clearRect(
          (regionNW.x - chartNW.x) * scaleX, (regionNW.y - chartNW.y) * scaleY,
          (regionSE.x - regionNW.x) * scaleX, (regionSE.y - regionNW.y) * scaleY,
        )
      }
    },
  }
}
