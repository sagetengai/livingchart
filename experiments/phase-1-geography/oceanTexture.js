import { MercatorCoordinate } from 'maplibre-gl'

const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(2.0 * uv - 1.0, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 pigment;

float hash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 t = fract(p);
  t = t * t * (3.0 - 2.0 * t);
  return mix(
    mix(hash(cell), hash(cell + vec2(1, 0)), t.x),
    mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), t.x), t.y);
}

vec2 eddy(vec2 p, vec2 center, float spin) {
  vec2 d = p - center;
  float a = spin * exp(-0.19 * dot(d, d));
  float c = cos(a), s = sin(a);
  return center + mat2(c, s, -s, c) * d;
}

void main() {
  // UV covers the same fixed Mercator rectangle as the bathymetry plate.
  vec2 p = (uv - 0.5) * vec2(16.0, 9.0);
  p = eddy(p, vec2(3.0, 0.5), 4.0);
  p = eddy(p, vec2(-4.4, -1.9), -3.4);
  vec2 bend = vec2(noise(0.6 * p + 14.5), noise(0.6 * p - 7.1)) - 0.5;
  vec2 flow = mat2(0.8, -0.6, 0.6, 0.8) * (p + 2.4 * bend);
  float broad = noise(flow * vec2(0.48, 1.9) + 4.0);
  float fine = noise(flow * vec2(0.78, 4.0) + 2.0 * broad);
  float tone = mix(broad, fine, 0.28) - 0.5;
  float opacity = 0.29 * smoothstep(0.03, 0.37, abs(tone));
  pigment = vec4(vec3(step(0.0, tone)), opacity);
}`

export function renderOceanTexture(land, coastline, corners) {
  const texture = document.createElement('canvas')
  texture.width = land.naturalWidth
  texture.height = land.naturalHeight
  const context = texture.getContext('2d')
  const gpu = document.createElement('canvas')
  // The pigment varies at regional scales. A smaller GPU buffer keeps generation cheap.
  gpu.width = Math.ceil(texture.width / 3)
  gpu.height = Math.ceil(texture.height / 3)
  const gl = gpu.getContext('webgl2', { antialias: false, premultipliedAlpha: false })
  if (!gl) throw new Error('WebGL 2 is unavailable.')

  const program = gl.createProgram()
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(error)
      }
      gl.attachShader(program, shader)
      gl.deleteShader(shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    context.drawImage(gpu, 0, 0, texture.width, texture.height)
  } finally {
    gl.deleteProgram(program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  // Clip at the original mask resolution, including small islands and inlets.
  context.globalCompositeOperation = 'destination-out'
  context.drawImage(land, 0, 0)
  // The GSHHG land raster also leaves inland lakes transparent.
  const northwest = MercatorCoordinate.fromLngLat(corners[0])
  const southeast = MercatorCoordinate.fromLngLat(corners[2])
  const scaleX = texture.width / (southeast.x - northwest.x)
  const scaleY = texture.height / (southeast.y - northwest.y)
  context.beginPath()
  for (const { geometry } of coastline.features) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    for (const [, ...holes] of polygons) {
      for (const ring of holes) {
        ring.forEach((point, index) => {
          const { x, y } = MercatorCoordinate.fromLngLat(point)
          const draw = index === 0 ? 'moveTo' : 'lineTo'
          context[draw]((x - northwest.x) * scaleX, (y - northwest.y) * scaleY)
        })
        context.closePath()
      }
    }
  }
  context.fill()
  context.lineWidth = 2
  context.stroke()
  return texture
}
