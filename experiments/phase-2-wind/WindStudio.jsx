import { useEffect, useRef, useState } from 'react'
import {
  chromaticFlowControls, layerNames, oceanControls, oceanDefaults, oceanPalettes, palettes, parsePreset, resourceKeys, serializePreset,
  terrainControls, windControls,
} from './windStudioSettings.js'
import ElevationData from './ElevationData.jsx'
import styles from './windStudio.css?inline'

const storageKey = theme => `living-chart.wind-studio.v1.${theme}`
const percent = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`

function Slider({ label, min, max, step, value, change, disabled, format = value => value }) {
  return <label className="studio-slider">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={event => change(Number(event.target.value))} />
    <output>{format(value)}</output>
  </label>
}

function WaterMask({ grid, coastal = false }) {
  const canvas = useRef(null)
  useEffect(() => {
    if (!grid) return
    const context = canvas.current.getContext('2d')
    const image = context.createImageData(grid.width, grid.height)
    const waterColor = [108, 182, 200, 255]
    const landColor = [18, 30, 40, 255]
    for (let i = 0; i < grid.width * grid.height; i++) {
      const water = coastal ? grid.pixels[i] < 128 : grid.pixels[i * 4 + 2] >= 128
      image.data.set(water ? waterColor : landColor, i * 4)
    }
    context.putImageData(image, 0, 0)
  }, [grid, coastal])
  return grid && <canvas ref={canvas} width={grid.width} height={grid.height}
    aria-label={coastal ? "Regional coastal mask. Blue is water." : "Global wind grid mask. Blue cells are valid."} role="img" />
}

export default function WindStudio({
  mapRef, regionalRelief, setRegionalRelief, theme, settings, update, reset, apply, pending, renderer, getDiagnostics, setPalette, ready,
}) {
  const [open, setOpen] = useState(false)
  const [showMask, setShowMask] = useState(false)
  const [metrics, setMetrics] = useState(null)
  const [message, setMessage] = useState('')
  const ribbons = renderer === 'experimental'
  const { chromaticFlow } = settings
  const terrain = settings.terrain
  const updateTerrain = changes => update({ terrain: { ...terrain, ...changes } })
  const ocean = settings.ocean
  const updateOcean = changes => update({ ocean: { ...ocean, ...changes } })

  useEffect(() => {
    if (!open) return
    const sample = () => setMetrics(getDiagnostics())
    sample()
    const timer = setInterval(sample, 1000)
    return () => clearInterval(timer)
  }, [open, getDiagnostics, renderer])

  const json = () => serializePreset(theme, settings)
  const run = action => {
    try { setMessage(action()) }
    catch (error) { setMessage(error.message) }
  }

  return <details className="wind-studio" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Wind Studio <small>LOCAL DEV</small></summary>
    <style>{styles}</style>
    {open && <div className="studio-body">
      <fieldset>
        <legend>Wind</legend>
        {!ribbons && <p>These simulation controls target History ribbons. Tint and layer controls also work with Original particles.</p>}
        {Object.entries(windControls).filter(([key]) => key !== 'seed').map(([key, [label, min, max, step]]) =>
          <Slider key={key} label={label + (resourceKeys.includes(key) ? ' *' : '')}
            min={min} max={max} step={step} value={settings[key]} disabled={!ribbons}
            format={key === 'opacity' ? value => `${Math.round(value * 100)}%` : undefined}
            change={value => update({ [key]: value })} />)}
        {settings.count < windControls.count[1] && <p>Legacy preset count: {settings.count}. New edits start at 100.</p>}
        <label className="studio-seed">Random seed *
          <input type="number" min="0" max="4294967295" step="1" value={settings.seed} disabled={!ribbons}
            onChange={event => {
              const value = event.target.valueAsNumber
              if (Number.isInteger(value) && value >= 0 && value <= 4294967295) update({ seed: value })
            }} />
        </label>
        <p>The shader fixes the mix of viewport and edge seeds.</p>
        <button disabled={!pending || !ribbons || !ready} onClick={() => run(() => {
          apply()
          return 'Applied count, history and seed.'
        })}>Apply</button>
        <small className="studio-apply">* Restarts ribbons when applied.</small>
        {pending && <p role="status">Count, history or seed changes are pending.</p>}
      </fieldset>
      {ribbons && chromaticFlow?.active && <fieldset>
        <legend>Chromatic Flow</legend>
        <p>Experimental controls saved with presets. Rendering effects are pending.</p>
        {Object.entries(chromaticFlowControls).map(([key, [label, min, max, step]]) =>
          <Slider key={key} label={label} min={min} max={max} step={step} value={chromaticFlow[key]}
            format={value => `${Math.round(value * 100)}%`}
            change={value => update({ chromaticFlow: { ...chromaticFlow, [key]: value } })} />)}
      </fieldset>}
      <fieldset>
        <legend>Color</legend>
        <label className="studio-seed">Wind tint
          <input type="color" value={settings.tint} onChange={event => update({ tint: event.target.value })} />
        </label>
        <label className="studio-seed">{theme === 'day' ? 'Day' : 'Night'} palette
          <select disabled={theme === 'day'} value={settings.palette} onChange={event => setPalette(event.target.value)}>
            {theme === 'day' ? <option value="sculpted-atlas">Sculpted Atlas</option> :
              Object.entries(palettes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        {theme === 'day' && <p>Day uses a single pre-rendered palette.</p>}
      </fieldset>
      <details className="studio-terrain">
        <summary>Terrain</summary>
        <label className="studio-seed">Land base color
          <input type="color" value={terrain.landColor ?? '#b5be93'}
            onChange={event => updateTerrain({ landColor: event.target.value })} />
        </label>
        {theme === 'day' && (terrain.landColor ? <button onClick={() => updateTerrain({ landColor: null })}>
          Use baked Day land
        </button> : <p>Day uses the baked land color until you choose an override.</p>)}
        <label><input type="checkbox" checked={terrain.visible}
          onChange={event => updateTerrain({ visible: event.target.checked })} /> Show land relief</label>
        {Object.entries(terrainControls).map(([key, [label, min, max, step]]) =>
          <Slider key={key} label={label} min={min} max={max} step={step} value={terrain[key]}
            change={value => updateTerrain({ [key]: value })}
            format={key === 'opacity' ? value => `${Math.round(value * 100)}%` : undefined} />)}
      </details>
      <details className="studio-ocean">
        <summary>Ocean</summary>
        {Object.entries(oceanControls).map(([key, [label, min, max, step]]) =>
          <Slider key={key} label={label} min={min} max={max} step={step} value={ocean[key]}
            change={value => updateOcean({ [key]: value })} format={value => `${Math.round(value * 100)}%`} />)}
        <label className="studio-seed">Ocean palette
          <select value={ocean.palette} onChange={event => updateOcean({ palette: event.target.value })}>
            {Object.entries(oceanPalettes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <p>Depth color, seafloor relief, and static current texture blend over the base bathymetry. Current motion is saved with presets.</p>
        <button onClick={() => update({ ocean: oceanDefaults(theme) })}>Reset Ocean Defaults</button>
      </details>
      <ElevationData mapRef={mapRef} regionalRelief={regionalRelief} setRegionalRelief={setRegionalRelief} />
      <fieldset>
        <legend>Layers</legend>
        {layerNames.map(name => {
          const layer = settings.layers[name]
          const label = name[0].toUpperCase() + name.slice(1)
          const disabled = name === 'land' && theme === 'day' && !terrain.landColor
          const change = value => update({ layers: { ...settings.layers, [name]: { ...layer, ...value } } })
          return <div className="studio-layer" key={name}>
            <label><input type="checkbox" checked={!disabled && layer.visible} disabled={disabled}
              onChange={event => change({ visible: event.target.checked })} /> {label}</label>
            <Slider label={label + ' opacity'} min={0} max={1} step={0.01} disabled={disabled}
              value={disabled ? 0 : layer.opacity} change={opacity => change({ opacity })} />
          </div>
        })}
        {theme === 'day' && !terrain.landColor && <p>Shaded land is part of the Day bathymetry image.</p>}
      </fieldset>
      <fieldset>
        <legend>Effects</legend>
        <Slider label="Vessel light" min={0} max={1} step={0.05} value={settings.vesselLight}
          disabled={!ribbons} format={value => `${Math.round(value * 100)}%`}
          change={value => update({ vesselLight: value })} />
        <p>{ribbons ? 'Lights the map and wind around its center. Updates live.' : 'Vessel light is available with History ribbons.'}</p>
      </fieldset>
      <fieldset>
        <legend>Diagnostics</legend>
        <dl>
          <div><dt>Ribbon FPS</dt><dd>{metrics?.fps ?? '—'}</dd></div>
          {ribbons && <div><dt>Applied seed capacity</dt><dd>{metrics?.capacity ?? '—'}</dd></div>}
          <div><dt>Active heads</dt><dd>{metrics?.heads ?? '—'}</dd></div>
          <div><dt>Valid water cells (original grid)</dt><dd>{percent(metrics?.coverage)}</dd></div>
          <div><dt>Water area (ribbon coast mask)</dt><dd>{percent(metrics?.coastCoverage)}</dd></div>
        </dl>
        <label><input type="checkbox" checked={showMask} onChange={event => setShowMask(event.target.checked)} /> Show masks</label>
        {showMask && <>
          <p>Original wind grid</p>
          {metrics?.grid ? <WaterMask grid={metrics.grid} /> : <p>Awaiting wind grid.</p>}
          <p>Ribbon coastal mask</p>
          {metrics?.coast ? <WaterMask grid={metrics.coast} coastal /> : <p>Awaiting coastal mask.</p>}
        </>}
      </fieldset>
      <div className="studio-presets">
        <button onClick={() => run(() => {
          localStorage.setItem(storageKey(theme), json())
          return 'Saved the current theme preset.'
        })}>Save Preset</button>
        <button onClick={() => run(() => {
          const saved = localStorage.getItem(storageKey(theme))
          if (!saved) throw new Error('No preset saved for this theme.')
          update(parsePreset(saved, theme))
          return 'Loaded the current theme preset.'
        })}>Load Preset</button>
        <button onClick={() => run(() => {
          reset()
          return 'Restored defaults for this theme.'
        })}>Reset to Defaults</button>
        <button onClick={() => run(() => {
          const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url
          link.download = `wind-studio-${theme}.json`
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          return 'Exported the current theme preset.'
        })}>Export JSON</button>
        <label className="studio-import">Import JSON
          <input type="file" accept=".json,application/json" onChange={async event => {
            const file = event.target.files[0]
            event.target.value = ''
            if (!file) return
            try {
              update(parsePreset(await file.text(), theme))
              setMessage('Imported the preset.')
            } catch (error) {
              setMessage(error.message)
            }
          }} />
        </label>
        {message && <p role="status">{message}</p>}
      </div>
    </div>}
  </details>
}
