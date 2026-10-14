import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { LoadBoundary } from './components/LoadBoundary'
import { rank, Variations } from './components/Variations'
import type { MetricId } from './components/Variations'
import { buildGpx, gpxFileName, shareOrDownload } from './export/gpx'
import type { LatLon } from './geo/geo'
import { searchPlaces } from './osm/nominatim'
import type { Place } from './osm/nominatim'
import type { PlanIn, PlanOut } from './planner/plannerWorker'
import { targetMeters } from './planner/units'
import type { Mode } from './planner/units'
import type { RouteResult } from './routing/solve'

const MapView = lazy(() => import('./components/MapView'))
const TOL = 0.1

type Busy = { msg: string; pct: number }

export function PlannerApp({ embedded = false }: { embedded?: boolean }) {
  const [loc, setLoc] = useState<{ ll: LatLon; label: string } | null>(null)
  const [mode, setMode] = useState<Mode>('distance')
  const [km, setKm] = useState(5)
  const [minutes, setMinutes] = useState(30)
  const [pace, setPace] = useState(6)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [list, setList] = useState<RouteResult[]>([])
  const [selected, setSelected] = useState<RouteResult | null>(null)
  const [metric, setMetric] = useState<MetricId>('score')
  const [open, setOpen] = useState(true)
  const worker = useRef<Worker | null>(null)

  const targetM = targetMeters(mode, km, minutes, pace)

  const gpx = useMemo(() => {
    if (!selected) return null
    const dist = selected.lengthM / 1000
    const name = `Loop - ${dist.toFixed(1)} km`
    const pts = selected.segments.flatMap((s) => s.pts)
    return {
      xml: buildGpx({ name, desc: `Planned loop, target ${(targetM / 1000).toFixed(1)} km. Map data © OpenStreetMap contributors.`, pts, kind: 'trk' }),
      name,
      file: gpxFileName('loop', dist),
    }
  }, [selected, targetM])

  function useMyLocation() {
    setMsg('Locating…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ ll: [p.coords.latitude, p.coords.longitude], label: 'My location' })
        setMsg('')
      },
      () => setMsg('Location blocked — search for a place or tap the map instead.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setMsg('Searching…')
    try {
      const r = await searchPlaces(query)
      setPlaces(r)
      setMsg(r.length ? '' : 'No matches.')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Search failed.')
    }
  }

  function plan() {
    if (!loc) return
    setMsg('')
    setList([])
    setSelected(null)
    setBusy({ msg: 'Starting…', pct: 0.05 })
    const w = (worker.current ??= new Worker(new URL('./planner/plannerWorker.ts', import.meta.url), { type: 'module' }))
    w.onmessage = (ev: MessageEvent<PlanOut>) => {
      const m = ev.data
      if (m.type === 'progress') {
        setBusy({ msg: m.phase === 'tiles' ? `Loading map tiles… ${m.done}/${m.total}` : 'Building street map…', pct: m.done / m.total })
        return
      }
      setBusy(null)
      if (m.type === 'error') setMsg(m.message)
      else if (!m.list.length) setMsg('No loop found here. Try another start point or length.')
      else {
        setList(m.list)
        setSelected(rank(m.list, metric)[0])
        if (m.warning) setMsg(m.warning)
      }
    }
    w.onerror = () => {
      worker.current?.terminate()
      worker.current = null
      setBusy(null)
      setMsg('Planning failed unexpectedly.')
    }
    const input: PlanIn = { center: loc.ll, targetM, tol: TOL }
    w.postMessage(input)
  }

  return (
    <div className={`gpxa${embedded ? ' gpxa-embed' : ''}`}>
      <div className="screen">
        <header className="top">
          <h1 style={{ margin: 0, fontSize: '1.1rem' }}>🏃 Route Planner</h1>
          <div className="seg" role="group" aria-label="Plan by">
            <button aria-pressed={mode === 'distance'} onClick={() => setMode('distance')}>
              📏 Distance
            </button>
            <button aria-pressed={mode === 'time'} onClick={() => setMode('time')}>
              ⏱️ Time
            </button>
          </div>
        </header>

        <div className="stage">
          <LoadBoundary>
            <Suspense fallback={<div className="tip">Loading map…</div>}>
              <MapView pin={loc?.ll ?? null} onPin={(p) => setLoc({ ll: p, label: 'Dropped pin' })} preview={null} result={selected} area={null} bottomPad={0} />
            </Suspense>
          </LoadBoundary>
          {!loc && <div className="tip">👆 Tap the map to set your start, or use the buttons below</div>}
          {list.length > 0 && (
            <Variations
              list={list}
              metric={metric}
              onMetric={(id) => {
                setMetric(id)
                setSelected(rank(list, id)[0])
              }}
              selected={selected}
              onSelect={setSelected}
              open={open}
              onToggle={() => setOpen(!open)}
            />
          )}
        </div>

        <footer className="foot">
          <div className="card">
            <div className="row">
              <button className="btn blue" onClick={useMyLocation}>
                📍 My location
              </button>
              <form className="row" onSubmit={search}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a place" aria-label="Search a place" />
                <button className="btn">Go</button>
              </form>
            </div>
            <ul className="places">
              {places.map((p) => (
                <li key={`${p.lat},${p.lon}`}>
                  <button
                    className="btn"
                    onClick={() => {
                      setLoc({ ll: [p.lat, p.lon], label: p.name })
                      setPlaces([])
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
            {mode === 'distance' ? (
              <label className="row">
                <span className="big">
                  {km} <small>km</small>
                </span>
                <input type="range" min={2} max={30} step={0.5} value={km} aria-label="Distance in km" onChange={(e) => setKm(+e.target.value)} />
              </label>
            ) : (
              <>
                <label className="row">
                  <span className="big">
                    {minutes} <small>min</small>
                  </span>
                  <input type="range" min={10} max={180} step={5} value={minutes} aria-label="Time in minutes" onChange={(e) => setMinutes(+e.target.value)} />
                </label>
                <label className="row">
                  Pace (min/km)
                  <input type="number" min={2} max={20} step={0.1} value={pace} onChange={(e) => setPace(+e.target.value)} />
                </label>
                <p className="muted">≈ {(targetM / 1000).toFixed(1)} km</p>
              </>
            )}
            {msg && <p className="warn">{msg}</p>}
          </div>

          <div className="actions">
            {busy ? (
              <div className="progress" role="progressbar" aria-label={busy.msg}>
                <div className="bar-fill" style={{ width: `${Math.round(busy.pct * 100)}%` }} />
                <span>{busy.msg}</span>
              </div>
            ) : (
              <>
                <button className="btn green grow" disabled={!loc} onClick={plan}>
                  {loc ? '🚀 Plan loops' : '📍 Choose a start'}
                </button>
                {gpx && (
                  <button className="btn blue" onClick={() => shareOrDownload(gpx.xml, gpx.file, gpx.name, false)}>
                    ⬇ GPX
                  </button>
                )}
              </>
            )}
          </div>
          <p className="muted fine">Routes are auto-generated: check paths are safe and accessible. Map data © OpenStreetMap contributors.</p>
        </footer>
      </div>
    </div>
  )
}
