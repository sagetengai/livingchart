import { useEffect, useRef, useState } from 'react'
import IntegratedGeography from '../phase-1-geography/IntegratedGeography.jsx'
import HistoryWindLayer, { PRESETS } from './HistoryWindLayer.js'

const params = new URLSearchParams(location.search)
const seed = Number(params.get('seed') || 20261105)
const manual = params.has('audit')
const ranges = { count:[100,1200,20], history:[24,160,8], width:[0.5,3,0.05], taper:[0.3,2,0.05], opacity:[0.1,0.8,0.02], speed:[500,3000,100], lifetime:[12,40,1], fade:[1,6,0.25] }
const labels = {count:'Particle count',history:'History positions',width:'Trail width',taper:'Taper strength',opacity:'Trail opacity',speed:'Speed multiplier',lifetime:'Trail lifetime',fade:'Fade duration'}

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
  const [renderer,setRenderer]=useState('experimental'), [preset,setPreset]=useState('calligraphic')
  const [options,setOptions]=useState({...PRESETS.calligraphic}), [palette,setPalette]=useState('deep-navy')
  const [status,setStatus]=useState('Loading GFS and geography…'), [error,setError]=useState('')
  const layerRef=useRef(null), context=useRef({})
  context.current={renderer,preset,options,palette,...props}
  useEffect(()=>{
    let originalControl, lastOptions, lastPalette, removed=false
    const timer=setInterval(()=>{
      try{
        const c=context.current, map=props.mapRef.current, grid=props.windGridRef.current, original=props.windLayerRef.current
        if(!map?.getLayer('phase1-land') || !grid || !original?.sourceLoaded)return
        if(!layerRef.current){
          const layer=new HistoryWindLayer({grid,seed,manual})
          map.addLayer(layer,'phase1-land');layerRef.current=layer
          if(manual){originalControl=controlOriginal(original);originalControl.reset()}
        }
        const layer=layerRef.current
        layer.enabled=c.renderer==='experimental';layer.setGrid(grid)
        if(lastOptions!==c.options){layer.configure(c.options);lastOptions=c.options}
        if(lastPalette!==c.palette){window.livingChart.setPalette(c.palette);lastPalette=c.palette}
        const d=layer.diagnostics()
        setStatus(`${c.mode==='forecast'?'NOAA GFS':'Awaiting forecast'} · ${d.options.count} paths · ${d.frameMs ? (1000/d.frameMs.mean).toFixed(0)+' fps' : 'growing trails'}`)
      }catch(e){if(!removed)setError(e.message)}
    },200)
    window.windExperiment={
      layer:()=>layerRef.current,
      setRenderer, setPreset:name=>{setPreset(name);setOptions({...PRESETS[name]})},setPalette,
      snapshot:()=>({renderer:context.current.renderer,preset:context.current.preset,palette:context.current.palette,forecast:context.current.frames[context.current.frameIndex],mode:context.current.mode,
        experiment:layerRef.current?.diagnostics(),original:originalControl?.snapshot(),baseline:window.livingChart?.snapshot()}),
      reset:()=>{layerRef.current.reset();originalControl?.reset()},
      advance:seconds=>context.current.renderer==='original'?originalControl.advance(seconds):layerRef.current.advance(seconds),
      nextForecast:()=>context.current.goToFrame(context.current.frameIndex+1),
    }
    return()=>{
      removed=true;clearInterval(timer);originalControl?.restore();delete window.windExperiment
      const map=props.mapRef.current
      if(map?.getLayer('phase2-wind'))map.removeLayer('phase2-wind')
      layerRef.current=null
    }
  },[props.mapRef,props.windLayerRef,props.windGridRef])

  return <>
    <IntegratedGeography {...props} controls={false} windVisible={renderer==='original'} />
    <style>{`
      .masthead,.conditions-panel,.timeline,.map-caption,.compass{display:none}
      .wind-lab{position:absolute;z-index:20;bottom:26px;left:50%;transform:translateX(-50%);color:#c3d4da;background:#0b1822ed;border:1px solid #344750;border-radius:7px;padding:13px 18px;font:12px system-ui;min-width:650px;box-shadow:0 4px 24px #0004}
      .wind-lab h2{font:18px Georgia;margin:0 0 5px;color:#dde5e4;letter-spacing:.04em}
      .wind-lab .controls{display:flex;gap:15px;align-items:center;margin-top:11px}
      .wind-lab label{display:flex;gap:7px;align-items:center;white-space:nowrap}
      .wind-lab select,.wind-lab button{font:inherit;color:#d3dfe1;background:#172a34;border:1px solid #3b525e;padding:6px;border-radius:3px}
      .wind-lab small{font-size:10px;color:#8199a5;letter-spacing:.05em}
      .wind-lab summary{cursor:pointer;color:#a6bec8}
      .wind-lab .tuning{display:grid;grid-template-columns:1fr 1fr;gap:11px 22px;padding-top:16px}
      .wind-lab .tuning label{display:grid;grid-template-columns:110px 120px 40px;gap:8px}
      .wind-lab input{width:120px;accent-color:#91b6c7}
      .wind-lab .error{color:#ffc6ac;max-width:700px}
      body.capture .wind-lab,body.capture [class*="maplibre"] [class*="control"],body.capture .maplibregl-ctrl{display:none!important}
    `}</style>
    <aside className="wind-lab">
      <h2>Living Chart · Wind studies</h2>
      <small>{status} · {props.frames[props.frameIndex] ? new Date(props.frames[props.frameIndex]*1000).toISOString().replace('T',' ').slice(0,16)+' UTC' : ''} · GEBCO / GSHHG</small>
      <div className="controls">
        <label>Renderer <select aria-label="Wind renderer" value={renderer} onChange={e=>setRenderer(e.target.value)}><option value="experimental">History ribbons</option><option value="original">Original particles</option></select></label>
        <label>Treatment <select aria-label="Wind treatment" disabled={renderer==='original'} value={preset} onChange={e=>{setPreset(e.target.value);setOptions({...PRESETS[e.target.value]})}}><option value="fine">Fine currents</option><option value="calligraphic">Calligraphic</option><option value="atmospheric">Atmospheric</option></select></label>
        <label>Sea <select aria-label="Sea palette" value={palette} onChange={e=>setPalette(e.target.value)}><option value="deep-navy">Deep navy</option><option value="blue-black">Blue-black</option><option value="muted-teal">Muted teal</option></select></label>
        <button onClick={()=>window.windExperiment.nextForecast()}>Next forecast</button>
      </div>
      <details style={{marginTop:11}}><summary>Tune strokes</summary><div className="tuning">{Object.entries(ranges).map(([key,[min,max,step]])=><label key={key}>{labels[key]}<input aria-label={labels[key]} type="range" min={min} max={max} step={step} value={options[key]} onChange={e=>setOptions({...options,[key]:Number(e.target.value)})}/><output>{options[key]}</output></label>)}</div></details>
      {error&&<p className="error">{error}</p>}
    </aside>
  </>
}
