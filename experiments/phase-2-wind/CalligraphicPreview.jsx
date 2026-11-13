import { useCallback, useEffect, useRef, useState } from 'react'
import IntegratedGeography from '../phase-1-geography/IntegratedGeography.jsx'
import HistoryWindLayer, { PRESETS, loadCoastMask } from './HistoryWindLayer.js'
import WindStudio from './WindStudio.jsx'
import { chromaticFlowDefaults, defaults, palettes, resourceKeys } from './windStudioSettings.js'

const params = new URLSearchParams(location.search)
const seed = Number(params.get('seed') || 20261105) >>> 0
const manual = params.has('audit')
const themeOpacity = { day: 1.25, night: 1.12 }

function windAppearance(tint, opacityMultiplier) {
  const rgb = tint.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
  return { rgb, opacityMultiplier }
}

function ribbonUniforms({ width, taper, opacity, speed, lifetime, fade }) {
  return { width, taper, opacity, speed, lifetime, fade }
}

// Original-renderer deterministic stepping lives only in the experimental audit.
function controlOriginal(wind) {
  const update=wind.updateParticles, gl=wind.gl
  let state=seed>>>0, pending=0, steps=0
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
  wind.updateParticles=function(...args) {
    const old=Math.random;Math.random=random
    try{for(let i=0,n=Math.min(pending,24);i<n;i++){this.lastTime=performance.now()-100;update.apply(this,args);steps++;pending--}}
    finally{Math.random=old}
  }
  return {
    reset(){
      state=seed>>>0;pending=0;steps=0
      const n=wind.bufferCapacity, size=Math.ceil(Math.sqrt(n)), positions=new Float32Array(n*2), ages=new Float32Array(n)
      for(let i=0;i<n;i++){
        positions[i*2]=Math.max(0,Math.min(1,(i%size)/(size-1)+(random()-.5)*.25/(size-1)))
        positions[i*2+1]=Math.max(0,Math.min(1,Math.floor(i/size)/(size-1)+(random()-.5)*.25/(size-1)))
        ages[i]=Math.floor(random()*100)
      }
      const previous=gl.getParameter(gl.ARRAY_BUFFER_BINDING)
      for(const buffer of [wind.particleBufferA,wind.particleBufferB,wind.seedBuffer]){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,positions)}
      for(const buffer of [wind.ageBufferA,wind.ageBufferB]){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,ages)}
      gl.bindBuffer(gl.ARRAY_BUFFER,previous);wind.currentBuffer=wind.particleBufferA;wind.nextBuffer=wind.particleBufferB
      wind.currentAgeBuffer=wind.ageBufferA;wind.nextAgeBuffer=wind.ageBufferB;wind.reseedViewport=true
    },
    advance(seconds){pending+=Math.round(seconds/.05);wind.map.triggerRepaint();return steps+pending},
    snapshot:()=>({steps,pending,elapsed:steps*.05}),
    restore(){wind.updateParticles=update},
  }
}

export default function CalligraphicPreview(props) {
  const [renderer,setRenderer]=useState('experimental')
  const [treatments, setTreatments] = useState({ day: 'calligraphic', night: 'calligraphic' })
  const [theme, setTheme] = useState('night')
  const [regionalRelief, setRegionalRelief] = useState(null)
  const [themes, setThemes] = useState(() => ({ day: defaults('day', seed), night: defaults('night', seed) }))
  const [applied, setApplied] = useState(() => ({ count: PRESETS.calligraphic.count, history: PRESETS.calligraphic.history, seed }))
  const [status,setStatus]=useState('Loading GFS and geography…'), [error,setError]=useState('')
  const [ready, setReady] = useState(false)
  const layerRef=useRef(null), context=useRef({}), coverageCache=useRef({})
  const settings = themes[theme]
  const preset = settings.chromaticFlow?.active ? 'chromatic-flow' : treatments[theme]
  const palette = themes.night.palette
  const pending = resourceKeys.some(key => settings[key] !== applied[key])

  const update = (changes, target = theme) => setThemes(current => ({
    ...current, [target]: { ...current[target], ...changes },
  }))
  const setPalette = value => {
    if (Object.hasOwn(palettes, value)) update({ palette: value }, 'night')
  }
  const selectTreatment = (name, target, currentSettings, apply = false) => {
    const { chromaticFlow } = currentSettings
    if (name === 'chromatic-flow') {
      update({ chromaticFlow: { ...chromaticFlowDefaults, ...chromaticFlow, active: true } }, target)
      return
    }
    if (!Object.hasOwn(PRESETS, name)) return
    const treatment = PRESETS[name]
    if (apply) applyResources({ ...currentSettings, ...treatment })
    setTreatments(current => ({ ...current, [target]: name }))
    update({ ...treatment, chromaticFlow: chromaticFlow && { ...chromaticFlow, active: false } }, target)
  }
  const applyResources = ({ count, history, seed }) => {
    const layer = layerRef.current
    if (!layer) throw new Error('Wait for the ribbon renderer to load.')
    const resized = count !== layer.options.count || history !== layer.options.history
    const reseeded = seed !== layer.seed
    layer.configure({ count, history })
    if (reseeded && !resized) {
      layer.reset()
      layer.map.triggerRepaint()
    }
    layer.seed = seed
    setApplied({ count, history, seed })
  }
  const getDiagnostics = useCallback(() => {
    const { renderer, settings } = context.current
    const layer = layerRef.current
    const original = props.windLayerRef.current
    const grid = props.windGridRef.current
    if (grid && grid !== coverageCache.current.grid) {
      let water = 0
      for (let i = 2; i < grid.pixels.length; i += 4) water += Number(grid.pixels[i] >= 128)
      Object.assign(coverageCache.current, { grid, coverage: water / (grid.width * grid.height) })
    }
    const coast = layer?.coast
    if (coast && coast !== coverageCache.current.coast) {
      let water = 0
      for (const alpha of coast.pixels) water += Number(alpha < 128)
      Object.assign(coverageCache.current, { coast, coastCoverage: water / coast.pixels.length })
    }
    const metrics = {
      grid, coverage: grid ? coverageCache.current.coverage : null,
      coast, coastCoverage: coast ? coverageCache.current.coastCoverage : null,
    }
    if (renderer === 'experimental' && layer) metrics.capacity = layer.options.count
    if (!settings.layers.wind.visible) return metrics
    if (renderer === 'original') return { ...metrics, heads: original?.sourceLoaded ? original.liveCount : null }
    if (!layer) return metrics
    const { frameMs } = layer.diagnostics()
    let heads = 0
    const state = layer.readState()
    for (let i = 0; i < state.length; i += 4) heads += Number(state[i + 3] > 0 && state[i + 2] > 0)
    return { ...metrics, heads, fps: frameMs && Math.round(1000 / frameMs.mean) }
  }, [props.windGridRef, props.windLayerRef])

  context.current={renderer,preset,palette,theme,settings,...props}
  useEffect(()=>{
    let originalControl, lastAppearance, lastUniforms, removed=false
    let coast
    loadCoastMask().then(mask=>{ coast=mask }).catch(e=>{ if(!removed)setError(e.message) })
    const timer=setInterval(()=>{
      try{
        const c=context.current, map=props.mapRef.current, grid=props.windGridRef.current, original=props.windLayerRef.current
        if (!grid?.unmaskedPixels) original?.setCoastalForecast?.(null, null)
        if(!map?.getLayer('phase1-land') || !coast || !grid?.unmaskedPixels || !original?.sourceLoaded)return
        if(!layerRef.current){
          const layer=new HistoryWindLayer({grid,coast,seed,manual})
          map.addLayer(layer,'phase1-land');layerRef.current=layer
          setReady(true)
          if(manual){originalControl=controlOriginal(original);originalControl.reset()}
        }
        const layer=layerRef.current
        const wind = c.settings.layers.wind
        const opacity = themeOpacity[c.theme] * wind.opacity
        const { vesselLight } = c.settings
        const appearanceKey = `${c.settings.tint}:${opacity}:${vesselLight}`
        if(lastAppearance !== appearanceKey){
          const appearance = windAppearance(c.settings.tint, opacity)
          original.setAppearance(appearance)
          layer.setAppearance({ ...appearance, vesselLight })
          lastAppearance = appearanceKey
        }
        if (c.renderer === 'original') original.setCoastalForecast?.(grid, coast)
        const enabled = c.renderer === 'experimental' && wind.visible
        if (layer.enabled !== enabled) {
          layer.enabled = enabled
          map.triggerRepaint()
        }
        layer.setGrid(grid)
        const uniforms = ribbonUniforms(c.settings)
        if (!lastUniforms || Object.keys(uniforms).some(key => uniforms[key] !== lastUniforms[key])) {
          layer.configure(uniforms)
          lastUniforms = uniforms
        }
        const d=layer.diagnostics()
        setStatus(`${c.mode==='forecast'?'NOAA GFS':'Awaiting forecast'} · ${d.options.count} paths · ${d.frameMs ? (1000/d.frameMs.mean).toFixed(0)+' fps' : 'growing trails'}`)
      }catch(e){if(!removed)setError(e.message)}
    },200)
    window.windExperiment={
      layer:()=>layerRef.current,
      setRenderer,
      setPreset: name => {
        const { theme, settings } = context.current
        selectTreatment(name, theme, settings, true)
      },
      setPalette,
      snapshot:()=>({renderer:context.current.renderer,preset:context.current.preset,palette:context.current.palette,theme:context.current.theme,forecast:context.current.frames[context.current.frameIndex],mode:context.current.mode,
        experiment:layerRef.current?.diagnostics(),original:originalControl?.snapshot(),baseline:window.livingChart?.snapshot()}),
      reset:()=>{layerRef.current.reset();originalControl?.reset()},
      advance:seconds=>context.current.renderer==='original'?originalControl.advance(seconds):layerRef.current.advance(seconds),
      nextForecast:()=>context.current.goToFrame(context.current.frameIndex+1),
    }
    return()=>{
      removed=true;clearInterval(timer);originalControl?.restore();delete window.windExperiment
      props.windLayerRef.current?.setAppearance(null)
      props.windLayerRef.current?.setCoastalForecast?.(null, null)
      const map=props.mapRef.current
      if(map?.getLayer('phase2-wind'))map.removeLayer('phase2-wind')
      layerRef.current=null
    }
  },[props.mapRef,props.windLayerRef,props.windGridRef])

  return <>
    <IntegratedGeography {...props} controls={false} theme={theme} studioLayers={settings.layers} terrain={settings.terrain} ocean={settings.ocean} regionalRelief={regionalRelief}
      studioPalette={palette} onStudioPaletteChange={setPalette} dayPalette={themes.day.palette} dayFrame={settings.dayFrame}
      windVisible={renderer === 'original' && settings.layers.wind.visible} />
    <style>{`
      .masthead,.conditions-panel,.timeline,.map-caption,.compass{display:none}
      .vessel-map-light{
        position:absolute;
        inset:0;
        z-index:1;
        pointer-events:none;
        background:radial-gradient(circle 65vmin at center, #7dc8e35c, #4787a93d 26%, transparent 67%, #020b1899);
      }
      .wind-lab{position:absolute;z-index:20;bottom:26px;left:50%;transform:translateX(-50%);color:#c3d4da;background:#0b1822ed;border:1px solid #344750;border-radius:7px;padding:13px 18px;font:12px system-ui;min-width:650px;box-shadow:0 4px 24px #0004}
      .wind-lab h2{font:18px Georgia;margin:0 0 5px;color:#dde5e4;letter-spacing:.04em}
      .wind-lab .controls{display:flex;gap:15px;align-items:center;margin-top:11px}
      .wind-lab label{display:flex;gap:7px;align-items:center;white-space:nowrap}
      .wind-lab select,.wind-lab button{font:inherit;color:#d3dfe1;background:#172a34;border:1px solid #3b525e;padding:6px;border-radius:3px}
      .wind-lab small{font-size:10px;color:#8199a5;letter-spacing:.05em}
      .wind-lab .error{color:#ffc6ac;max-width:700px}
      body.capture .wind-lab,body.capture [class*="maplibre"] [class*="control"],body.capture .maplibregl-ctrl{display:none!important}
    `}</style>
    {renderer === 'experimental' && settings.vesselLight > 0 &&
      <div className="vessel-map-light" aria-hidden="true" style={{ opacity: settings.vesselLight }} />}
    <aside className="wind-lab">
      <h2>Living Chart · Wind studies</h2>
      <small>{status} · {props.frames[props.frameIndex] ? new Date(props.frames[props.frameIndex]*1000).toISOString().replace('T',' ').slice(0,16)+' UTC' : ''} · GEBCO / GSHHG</small>
      <div className="controls">
        <label>Renderer <select aria-label="Wind renderer" value={renderer} onChange={e=>setRenderer(e.target.value)}><option value="experimental">History ribbons</option><option value="original">Original particles</option></select></label>
        <label>Treatment <select aria-label="Wind treatment" disabled={renderer==='original'} value={preset} onChange={e=>selectTreatment(e.target.value, theme, settings)}><option value="fine">Fine currents</option><option value="calligraphic">Calligraphic</option><option value="atmospheric">Atmospheric</option><option value="chromatic-flow">Chromatic Flow</option></select></label>
        <label>Theme <select aria-label="Chart theme" value={theme} onChange={e=>setTheme(e.target.value)}>
          <option value="night">Night · Midnight Current</option>
          <option value="day">Day · Sculpted Atlas</option>
        </select></label>
        <button onClick={()=>window.windExperiment.nextForecast()}>Next forecast</button>
      </div>
      {error&&<p className="error">{error}</p>}
    </aside>
    <WindStudio mapRef={props.mapRef} regionalRelief={regionalRelief} setRegionalRelief={setRegionalRelief}
      theme={theme} settings={settings} renderer={renderer}
      ready={ready} pending={pending} getDiagnostics={getDiagnostics} setPalette={theme === 'day' ? value => update({ palette: value }) : setPalette}
      update={update} apply={() => applyResources(settings)}
      reset={() => {
        setTreatments(current => ({ ...current, [theme]: 'calligraphic' }))
        update(defaults(theme, seed))
      }} />
  </>
}
