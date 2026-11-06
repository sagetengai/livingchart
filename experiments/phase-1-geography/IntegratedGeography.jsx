import { useEffect, useRef, useState } from 'react'
import { sampleWind } from '../../src/windData.js'

const BASE = '/artifacts/phase-1-geography/'
const GEOGRAPHY = 'phase1-bathymetry'
const LAND = 'phase1-land'

// Mounted only by the explicitly selected local geography comparison mode.
export default function IntegratedGeography({ mapRef, windLayerRef, windGridRef, mode, frames, frameIndex, goToFrame, controls = true, windVisible = true }) {
  const [view, setView] = useState('combined')
  const [palette, setPalette] = useState('deep-navy')
  const [error, setError] = useState('')
  const context = useRef({})
  const counts = useRef({ drawCalls: 0, updates: 0, sourceLoads: 0 })
  context.current = { view, palette, mode, frames, frameIndex, goToFrame, windVisible }

  useEffect(() => {
    let disposed = false, metadata, initialized = false, instrumented
    let previousKey = ''
    const visibility = new Map()
    fetch(BASE + 'manifest.json').then(r => {
      if (!r.ok) throw new Error(`Geography manifest HTTP ${r.status}`)
      return r.json()
    }).then(value => { metadata = value }).catch(e => setError(e.message))

    const apply = () => {
      const map = mapRef.current, wind = windLayerRef.current
      if (disposed || !metadata || !map) return
      // Once installed, mode changes must not wait for original WMS/cloud tiles.
      if (!initialized && !map.isStyleLoaded()) return
      if (!initialized) {
        const [w, s, e, n] = metadata.bounds_wsen
        map.setMaxBounds([[w, s], [e, n]])
        map.fitBounds([[w, s], [e, n]], { padding: 0, duration: 0 })
        map.addSource(GEOGRAPHY, { type: 'image', url: BASE + 'deep-navy-3840x2160.png', coordinates: metadata.image_source_coordinates })
        map.addLayer({ id: GEOGRAPHY, type: 'raster', source: GEOGRAPHY, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } })
        map.addSource(LAND, { type: 'geojson', data: BASE + 'coastline.geojson' })
        map.addLayer({ id: LAND, type: 'fill', source: LAND, paint: { 'fill-color': metadata.land, 'fill-opacity': 1, 'fill-antialias': true } })
        initialized = true
      }
      if (wind?.gl && wind !== instrumented) {
        instrumented = wind
        const draw = wind.bindAndDrawParticles
        const update = wind.updateParticles
        const loaded = wind.finalizeSourceLoad
        wind.bindAndDrawParticles = function (...args) { counts.current.drawCalls++; return draw.apply(this, args) }
        wind.updateParticles = function (...args) {
          const before = this.currentBuffer
          const result = update.apply(this, args)
          if (before !== this.currentBuffer) counts.current.updates++
          return result
        }
        wind.finalizeSourceLoad = function (...args) { counts.current.sourceLoads++; return loaded.apply(this, args) }
        instrumented.restoreDiagnostics = () => {
          wind.bindAndDrawParticles = draw; wind.updateParticles = update; wind.finalizeSourceLoad = loaded
        }
      }
      const state = context.current
      const layers = map.getStyle().layers
      // A late wind/cloud load must also get the comparison visibility/order.
      // getStyle().layers omits custom layers; include the actual draw order so
      // a wind layer arriving after the geography also gets placed correctly.
      const key = [state.view, state.palette, state.windVisible, ...map.getLayersOrder()].join('|')
      if (key === previousKey) return
      previousKey = key
      map.getSource(GEOGRAPHY).updateImage({ url: BASE + state.palette + '-3840x2160.png' })
      const custom = state.view !== 'original'
      for (const layer of layers) {
        if ([GEOGRAPHY, LAND, 'cortez-wind'].includes(layer.id)) continue
        if (!visibility.has(layer.id)) visibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility') || 'visible')
        map.setLayoutProperty(layer.id, 'visibility', custom ? 'none' : visibility.get(layer.id))
      }
      for (const id of [GEOGRAPHY, LAND]) map.setLayoutProperty(id, 'visibility', custom ? 'visible' : 'none')
      if (map.getLayer('cortez-wind')) {
        if (custom) {
          map.moveLayer(GEOGRAPHY, 'cortez-wind')
          map.moveLayer(LAND)
        }
        wind.readyForDisplay = state.view !== 'geography' && state.windVisible
      }
      map.triggerRepaint()
    }
    const timer = setInterval(apply, 200)

    window.livingChart = {
      map: () => mapRef.current,
      wind: () => windLayerRef.current,
      grid: () => windGridRef.current,
      setView, setPalette,
      nextForecast: () => context.current.goToFrame(context.current.frameIndex + 1),
      snapshot: () => {
        const wind = windLayerRef.current, grid = windGridRef.current, map = mapRef.current
        const state = context.current
        return { ...counts.current, view: state.view, palette: state.palette, mode: state.mode,
          frameIndex: state.frameIndex, validTime: state.frames[state.frameIndex],
          activeParticleCount: wind?.liveCount, ready: wind?.readyForDisplay, sourceLoaded: wind?.sourceLoaded,
          renderer: wind?.constructor.name, rendererRangesMph: [wind?.valueRange_u, wind?.valueRange_v],
          grid: grid && { width: grid.width, height: grid.height, bounds: grid.bounds, ranges: grid.ranges },
          center: map?.getCenter().toArray(), zoom: map?.getZoom(),
          layers: map?.getLayersOrder().map(id => ({ id, visibility: id === 'cortez-wind' ? (wind?.readyForDisplay ? 'visible' : 'none') : map.getLayoutProperty(id, 'visibility') || 'visible' })) }
      },
      particles: () => {
        const wind = windLayerRef.current, grid = windGridRef.current
        if (!wind?.gl || !grid) return []
        const gl = wind.gl, previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING)
        const xy = new Float32Array(wind.liveCount * 2), ages = new Float32Array(wind.liveCount)
        gl.bindBuffer(gl.ARRAY_BUFFER, wind.currentBuffer); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, xy)
        gl.bindBuffer(gl.ARRAY_BUFFER, wind.currentAgeBuffer); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, ages)
        gl.bindBuffer(gl.ARRAY_BUFFER, previous)
        const [w, n, e, s] = wind.bounds
        return Array.from(ages, (age, index) => {
          const longitude = w + xy[index * 2] * (e - w), latitude = n - xy[index * 2 + 1] * (n - s)
          return { index, age, longitude, latitude, sample: sampleWind(grid, longitude, latitude) }
        })
      },
    }
    return () => {
      disposed = true; clearInterval(timer); instrumented?.restoreDiagnostics?.(); delete window.livingChart
      const map = mapRef.current
      if (map?.getStyle()) {
        for (const [id, value] of visibility) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', value)
        }
        for (const id of [LAND, GEOGRAPHY]) {
          if (map.getLayer(id)) map.removeLayer(id)
          if (map.getSource(id)) map.removeSource(id)
        }
      }
      if (windLayerRef.current) windLayerRef.current.readyForDisplay = true
    }
  }, [mapRef, windLayerRef, windGridRef])

  return <>
    <style>{`
      .geography-controls{position:absolute;z-index:10;left:50%;top:22px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:#0b1a25ee;color:#d4e1e6;border:1px solid #49616a;padding:10px 14px;border-radius:5px;font:12px system-ui}
      .geography-controls label{display:flex;align-items:center;gap:7px;white-space:nowrap}
      .geography-controls select{background:#192c36;color:#d4e1e6;border:1px solid #49616a;border-radius:3px;padding:6px;font:inherit}
      .geography-error{position:absolute;z-index:11;top:80px;left:30px;color:#ffc6b3}
      body.capture .masthead,body.capture .conditions-panel,body.capture .timeline,body.capture .map-caption,body.capture .compass,body.capture .maplibregl-ctrl-container,body.capture .geography-controls{display:none}
    `}</style>
    {controls && <div className="geography-controls">
      <label>View <select aria-label="Comparison view" value={view} onChange={e => setView(e.target.value)}>
        <option value="original">Original Living Chart</option><option value="combined">Bathymetry + wind</option><option value="geography">Geography only</option>
      </select></label>
      <label>Palette <select aria-label="Bathymetry palette" value={palette} disabled={view === 'original'} onChange={e => setPalette(e.target.value)}>
        <option value="deep-navy">Deep navy</option><option value="blue-black">Blue-black</option><option value="muted-teal">Muted teal</option>
      </select></label>
    </div>}
    {error && <p className="geography-error">{error}</p>}
  </>
}
