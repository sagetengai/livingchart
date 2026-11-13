import { useEffect, useRef, useState } from 'react'
import DayFrame from './DayFrame.jsx'
import { dayRasterPaint, defaultDayPalette } from './dayChart.js'
import { loadLandRelief } from './landRelief.js'
import { createOceanRenderer } from './oceanPreview.js'
import { sampleWind } from '../../src/windData.js'

const BASE = '/artifacts/phase-1-geography/'
const DAY_IMAGE = '/artifacts/cartography/day/day.png'
const GEOGRAPHY = 'phase1-bathymetry'
const LAND = 'phase1-land'
const RELIEF = 'phase1-land-relief'
const REGIONAL_RELIEF = 'studio-regional-relief'
const SELECTION = 'studio-elevation-selection'

// Mounted only by the explicitly selected local geography comparison mode.
export default function IntegratedGeography({ mapRef, windLayerRef, windGridRef, mode, frames, frameIndex, goToFrame, controls = true, windVisible = true, theme = 'night',
  studioLayers, terrain, ocean, regionalRelief, studioPalette, onStudioPaletteChange, dayPalette, dayFrame, activeCloudRef }) {
  const [view, setView] = useState('combined')
  const [localPalette, setLocalPalette] = useState('deep-navy')
  const palette = studioPalette ?? localPalette
  const setPalette = onStudioPaletteChange ?? setLocalPalette
  const [bounds, setBounds] = useState(null)
  const [error, setError] = useState('')
  const [oceanError, setOceanError] = useState('')
  const context = useRef({})
  const counts = useRef({ drawCalls: 0, updates: 0, sourceLoads: 0 })
  context.current = { view, palette, mode, frames, frameIndex, goToFrame, windVisible, theme, studioLayers, terrain, ocean, regionalRelief, dayPalette }

  useEffect(() => {
    let disposed = false, metadata, initialized = false, instrumented
    let previousKey = '', imageUrl, relief, previousRegional
    let rasterPalette
    let oceanKey = '', oceanRevision = 0, oceanApplied = false
    const renderOcean = context.current.ocean && createOceanRenderer()
    const reliefKeys = new Map()
    if (context.current.terrain) {
      loadLandRelief().then(value => { relief = value }).catch(() => {
        if (!disposed) setError('Land relief asset unavailable. Generate it with tools/cartography/render_relief.py.')
      })
    }
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
      const state = context.current
      const day = state.theme === 'day'
      const nextImageUrl = day ? DAY_IMAGE : BASE + state.palette + '-3840x2160.png'
      if (!initialized) {
        const [w, s, e, n] = metadata.bounds_wsen
        map.setMaxBounds([[w, s], [e, n]])
        map.fitBounds([[w, s], [e, n]], { padding: 0, duration: 0 })
        map.addSource(GEOGRAPHY, { type: 'image', url: nextImageUrl, coordinates: metadata.image_source_coordinates })
        map.addLayer({ id: GEOGRAPHY, type: 'raster', source: GEOGRAPHY, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } })
        map.addSource(LAND, { type: 'geojson', data: BASE + 'coastline.geojson' })
        map.addLayer({ id: LAND, type: 'fill', source: LAND, paint: { 'fill-color': metadata.land, 'fill-opacity': 1, 'fill-antialias': true } })
        imageUrl = nextImageUrl
        initialized = true
        setBounds(metadata.bounds_wsen)
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
      if (imageUrl !== nextImageUrl) {
        map.getSource(GEOGRAPHY).updateImage({ url: nextImageUrl })
        imageUrl = nextImageUrl
        oceanApplied = false
      }
      const ocean = state.ocean
      const nextOceanKey = renderOcean && state.view !== 'original' && (ocean.depthColor || ocean.seafloorRelief || ocean.currentTexture)
        ? [nextImageUrl, ocean.palette, ocean.depthColor, ocean.seafloorRelief, ocean.currentTexture].join('|') : ''
      if (nextOceanKey !== oceanKey) {
        oceanKey = nextOceanKey
        const revision = ++oceanRevision
        const isCurrent = () => !disposed && revision === oceanRevision
        const source = map.getSource(GEOGRAPHY)
        if (oceanKey) {
          renderOcean(nextImageUrl, state.theme, ocean, metadata.image_source_coordinates, isCurrent).then(image => {
            if (!image || !isCurrent()) return
            source.updateImage({ image })
            oceanApplied = true
            setOceanError('')
          }).catch(() => {
            if (!isCurrent()) return
            if (oceanApplied) source.updateImage({ url: nextImageUrl })
            oceanApplied = false
            setOceanError('Ocean plates unavailable. Generate them with tools/cartography/render_ocean.py.')
          })
        } else {
          if (oceanApplied) source.updateImage({ url: nextImageUrl })
          oceanApplied = false
          setOceanError('')
        }
      }
      const studio = state.studioLayers
      const terrain = state.terrain
      const paint = (id, property, value) => {
        if (map.getLayer(id) && map.getPaintProperty(id, property) !== value) {
          map.setPaintProperty(id, property, value)
        }
      }
      const nextRasterPalette = day ? state.dayPalette ?? defaultDayPalette : null
      if (nextRasterPalette !== rasterPalette) {
        // The neutral Day palette has the same paint values as the ungraded Night raster.
        for (const [property, value] of Object.entries(dayRasterPaint(nextRasterPalette))) {
          paint(GEOGRAPHY, property, value)
        }
        rasterPalette = nextRasterPalette
      }
      // Keep the fill as the wind insertion anchor even when Day uses its baked land.
      const landOpacity = day && !terrain?.landColor ? 0 : studio?.land.opacity ?? 1
      paint(LAND, 'fill-opacity', landOpacity)
      paint(LAND, 'fill-color', terrain?.landColor ?? metadata.land)
      const regional = state.regionalRelief
      if (previousRegional !== regional) {
        if (map.getLayer(REGIONAL_RELIEF)) map.removeLayer(REGIONAL_RELIEF)
        if (map.getSource(REGIONAL_RELIEF)) map.removeSource(REGIONAL_RELIEF)
        reliefKeys.delete(REGIONAL_RELIEF)
        previousRegional = regional
      }
      const showRelief = terrain?.visible && state.view !== 'original'
      const reliefLayers = [
        [RELIEF, relief, metadata.image_source_coordinates, showRelief],
        [REGIONAL_RELIEF, regional, regional?.coordinates, showRelief && !!regional],
      ]
      for (const [id, image, coordinates, visible] of reliefLayers) {
        if (!image || !terrain) continue
        const cutout = id === RELIEF ? regional?.coordinates : undefined
        const key = [terrain.contrast, terrain.shadows, terrain.highlights, cutout].join('|')
        if (visible && reliefKeys.get(id) !== key) {
          image.recolor(terrain, coordinates, cutout)
          const source = map.getSource(id)
          if (source) {
            source.play()
            map.once('render', () => { if (!disposed && map.getSource(id) === source) source.pause() })
          }
          reliefKeys.set(id, key)
        }
        if (visible && !map.getLayer(id)) {
          map.addSource(id, { type: 'canvas', canvas: image.canvas, animate: false, coordinates })
          map.addLayer({ id, type: 'raster', source: id,
            paint: { 'raster-fade-duration': 0, 'raster-opacity': terrain.opacity } })
        }
        paint(id, 'raster-opacity', terrain.opacity)
        if (map.getLayer(id)) {
          const visibility = visible ? 'visible' : 'none'
          if (map.getLayoutProperty(id, 'visibility') !== visibility) map.setLayoutProperty(id, 'visibility', visibility)
        }
      }
      const cloudId = activeCloudRef?.current?.layerId
      if (studio) {
        paint(GEOGRAPHY, 'raster-opacity', studio.bathymetry.opacity)
        paint('cortez-coastline', 'line-opacity', studio.coastline.opacity)
        if (cloudId) paint(cloudId, 'raster-opacity', studio.clouds.opacity)
      }
      const layers = map.getStyle().layers
      // getStyle().layers omits custom layers. Use draw order to catch late arrivals.
      const flags = [state.view, state.palette, state.windVisible, cloudId,
        studio?.land.visible, studio?.bathymetry.visible, studio?.clouds.visible, studio?.coastline.visible]
      const key = [...flags, ...map.getLayersOrder()].join('|')
      if (key === previousKey) return
      const custom = state.view !== 'original'
      const show = (id, visible) => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      for (const layer of layers) {
        if ([GEOGRAPHY, LAND, RELIEF, REGIONAL_RELIEF, SELECTION, 'cortez-wind'].includes(layer.id)) continue
        if (!visibility.has(layer.id)) visibility.set(layer.id, map.getLayoutProperty(layer.id, 'visibility') || 'visible')
        const studioVisible = layer.id === 'cortez-coastline' && studio?.coastline.visible ||
          layer.id.startsWith('goes-cloud-layer-') && studio?.clouds.visible
        map.setLayoutProperty(layer.id, 'visibility', custom ? (studioVisible ? 'visible' : 'none') : visibility.get(layer.id))
      }
      show(GEOGRAPHY, custom && (studio?.bathymetry.visible ?? true))
      show(LAND, custom && (studio?.land.visible ?? true))
      if (map.getLayer('cortez-wind')) {
        if (custom) {
          map.moveLayer(GEOGRAPHY, 'cortez-wind')
          if (studio) {
            for (const layer of layers) {
              if (layer.id.startsWith('goes-cloud-layer-')) map.moveLayer(layer.id, 'cortez-wind')
            }
          }
          if (terrain) {
            map.moveLayer(LAND, 'cortez-wind')
            for (const id of [RELIEF, REGIONAL_RELIEF]) {
              if (map.getLayer(id)) map.moveLayer(id, 'cortez-wind')
            }
            if (map.getLayer('phase2-wind')) map.moveLayer('phase2-wind')
          } else {
            map.moveLayer(LAND)
          }
          if (studio && map.getLayer('cortez-coastline')) map.moveLayer('cortez-coastline')
        }
        wind.readyForDisplay = state.view !== 'geography' && state.windVisible
      }
      previousKey = [...flags, ...map.getLayersOrder()].join('|')
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
        return { ...counts.current, view: state.view, palette: state.palette, theme: state.theme, mode: state.mode,
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
        for (const id of [REGIONAL_RELIEF, RELIEF, LAND, GEOGRAPHY]) {
          if (map.getLayer(id)) map.removeLayer(id)
          if (map.getSource(id)) map.removeSource(id)
        }
      }
      if (windLayerRef.current) windLayerRef.current.readyForDisplay = true
    }
  }, [mapRef, windLayerRef, windGridRef, activeCloudRef])

  return <>
    {theme === 'day' && view !== 'original' && bounds && dayFrame && dayFrame.mode !== 'off' &&
      <DayFrame map={mapRef.current} bounds={bounds} frame={dayFrame} palette={dayPalette} />}
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
    {(error || oceanError) && <p className="geography-error">{error || oceanError}</p>}
  </>
}
