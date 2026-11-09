import { useEffect, useState } from 'react'
import { loadLandRelief } from '../phase-1-geography/landRelief.js'

const prefix = '/__elevation'
const initial = { west: '-111.6', south: '24', east: '-110.7', north: '24.8' }
const active = ['queued', 'downloading', 'processing', 'cancelling']
const mib = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MiB`
const outline = 'studio-elevation-selection'

async function request(path, body, signal) {
  const response = await fetch(prefix + path, {
    signal,
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) throw new Error(result?.error || 'Start the local elevation backend.')
  return result
}

export default function ElevationData({ mapRef, regionalRelief, setRegionalRelief }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [offline, setOffline] = useState(false)
  const [dataset, setDataset] = useState('COP30')
  const [bounds, setBounds] = useState(initial)
  const [estimate, setEstimate] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selection = { dataset, ...bounds }
  const job = status?.job
  const running = active.includes(job?.state)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let timer
    const poll = async () => {
      try {
        setStatus(await request('/status', null, controller.signal))
        setOffline(false)
      } catch {
        if (!controller.signal.aborted) setOffline(true)
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 750)
    }
    poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open])

  useEffect(() => () => {
    const map = mapRef.current
    if (map?.getLayer(outline)) map.removeLayer(outline)
    if (map?.getSource(outline)) map.removeSource(outline)
  }, [mapRef])

  const perform = async action => {
    setBusy(true)
    setError('')
    try { await action() }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const changeBounds = values => { setBounds(values); setEstimate(null) }
  const useViewport = () => {
    const view = mapRef.current?.getBounds()
    if (!view || !status?.chartBounds) throw new Error('Wait for the map and backend.')
    const [w, s, e, n] = status.chartBounds
    changeBounds({
      west: Math.max(w, view.getWest()).toFixed(6), south: Math.max(s, view.getSouth()).toFixed(6),
      east: Math.min(e, view.getEast()).toFixed(6), north: Math.min(n, view.getNorth()).toFixed(6),
    })
  }
  const showOutline = ([w, s, e, n]) => {
    const map = mapRef.current
    if (!map?.getLayer('phase1-land')) throw new Error('Wait for the chart geography.')
    const data = { type: 'Feature', properties: {}, geometry: {
      type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]],
    } }
    if (map.getSource(outline)) map.getSource(outline).setData(data)
    else {
      map.addSource(outline, { type: 'geojson', data })
      map.addLayer({ id: outline, type: 'line', source: outline,
        paint: { 'line-color': '#f8d18a', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
    }
  }

  return <details className="studio-terrain" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Elevation Data</summary>
    {open && <div className="studio-elevation">
      <p>{offline ? 'Elevation backend offline.' : !status ? 'Checking elevation backend…' :
        status.authenticated ? 'OpenTopography authenticated.' :
          status.keyConfigured ? 'API key configured. Authentication is checked on download.' :
            'Set OPENTOPO_API_KEY to download uncached data.'}</p>
      {status && !status.storageConfigured && <p>Set LIVINGCHART_DATA_DIR to an existing external folder.</p>}
      <label className="studio-seed">DEM dataset
        <select value={dataset} onChange={event => { setDataset(event.target.value); setEstimate(null) }}>
          {Object.entries(status?.datasets ?? { COP30: { name: 'Copernicus GLO-30' } }).map(([id, info]) =>
            <option key={id} value={id}>{info.name}</option>)}
        </select>
      </label>
      {status?.datasets[dataset] && <p>Nominal source resolution {status.datasets[dataset].resolution} m.</p>}
      {Object.entries(bounds).map(([name, value]) => <label key={name} className="studio-seed">
        <span>{name[0].toUpperCase() + name.slice(1)}</span>
        <input type="number" step="any" value={value}
          onChange={event => changeBounds({ ...bounds, [name]: event.target.value })} />
      </label>)}
      <button disabled={busy || offline || !status} onClick={() => perform(useViewport)}>Use current viewport</button>
      <button disabled={busy || offline || !status} onClick={() => perform(async () => {
        const result = await request('/estimate', selection)
        setEstimate(result)
        showOutline(result.bounds)
      })}>Preview region and estimate</button>
      {estimate && <p>{mib(estimate.estimatedBytes)} uncompressed estimate · {estimate.cached}/{estimate.tiles} tiles cached.</p>}
      <button disabled={busy || running || offline || !status?.storageConfigured}
        onClick={() => perform(async () => {
          const next = await request('/download', selection)
          setStatus(current => ({ ...current, job: next }))
        })}>Download elevation data</button>
      {running && <button disabled={busy || job.state === 'cancelling'}
        onClick={() => perform(async () => { await request('/cancel', {}) })}>Cancel</button>}
      {job && <p role="status">{job.state} · {job.complete}/{job.tiles} tiles · {job.cached} reused
        {job.state === 'downloading' && job.received > 0 && ` · ${mib(job.received)}${job.total ? ' / ' + mib(job.total) : ''}`}</p>}
      {job?.result && <div>
        <p>{job.result.dataset} · {mib(job.result.sourceBytes)} GeoTIFF · {job.result.bounds.join(', ')}</p>
        <img src={job.result.url} alt="Grayscale land hillshade preview" style={{ width: '100%' }} />
        <button disabled={busy} onClick={() => perform(async () => {
          const relief = await loadLandRelief(job.result.url)
          setRegionalRelief({ ...relief, coordinates: job.result.coordinates })
          const map = mapRef.current
          if (map?.getLayer(outline)) map.removeLayer(outline)
          if (map?.getSource(outline)) map.removeSource(outline)
        })}>Apply to Preview</button>
      </div>}
      {regionalRelief && <button onClick={() => setRegionalRelief(null)}>Restore original terrain</button>}
      {(error || job?.error) && <p role="alert">{error || job.error}</p>}
    </div>}
  </details>
}
