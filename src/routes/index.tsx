import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { DrawCanvas } from '../components/DrawCanvas'
import type { Stroke } from '../canvas/drawing'
import { textStrokes } from '../canvas/hershey'
import { buildGpx, canShareFiles, gpxFileName, shareOrDownload } from '../export/gpx'
import type { LatLon } from '../geo/geo'
import { frame } from '../geo/geo'
import { bboxAround, fetchElements } from '../osm/overpass'
import { searchPlaces } from '../osm/nominatim'
import type { Place } from '../osm/nominatim'
import { place, prepare } from '../routing/pipeline'
import type { RouteResult } from '../routing/solve'
import type { WorkerOut } from '../worker/routeWorker'

const MapView = lazy(() => import('../components/MapView'))

export const Route = createFileRoute('/')({ component: App })

const UNIT_M = { km: 1000, mi: 1609.344 }
const MAX = { km: 25, mi: 15 }
const MIN_M_PER_VERTEX = 60 // ~one city block of detail per drawing vertex

function App() {
  const [view, setView] = useState<'draw' | 'map'>('draw')
  const [sheet, setSheet] = useState(false)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [shape, setShape] = useState('drawing')
  const [text, setText] = useState('')
  const [loc, setLoc] = useState<{ ll: LatLon; label: string } | null>(null)
  const [dist, setDist] = useState(5)
  const [unit, setUnit] = useState<'km' | 'mi'>('km')
  const [tol, setTol] = useState(0.1)
  const [pace, setPace] = useState(6)
  const [kind, setKind] = useState<'trk' | 'rte'>('trk')
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [locMsg, setLocMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RouteResult | null>(null)
  const [canShare, setCanShare] = useState(false)
  const worker = useRef<Worker | null>(null)
  const abort = useRef<AbortController | null>(null)

  const targetM = dist * UNIT_M[unit]
  const prep = useMemo(() => prepare(strokes), [strokes])
  const minM = prep ? prep.vertices * MIN_M_PER_VERTEX : 0

  // Any input change makes the shown route stale.
  useEffect(() => setResult(null), [strokes, loc, targetM, tol])
  useEffect(() => setCanShare(canShareFiles()), [])
  // Keyboard-aware height: iOS doesn't shrink dvh when the keyboard opens.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
    set()
    vv.addEventListener('resize', set)
    return () => vv.removeEventListener('resize', set)
  }, [])

  const preview = useMemo(() => {
    if (!prep || !loc) return null
    const W = targetM / prep.unitLen / 1.3 // rough: routed length is ~1.3× the drawn length
    const f = frame(loc.ll[0], loc.ll[1])
    return place(prep.strokes, W, 0, [0, 0]).map((s) => s.map((p) => f.toLatLon(p)))
  }, [prep, loc, targetM])

  const gpx = useMemo(() => {
    if (!result) return null
    const km = result.lengthM / 1000
    const name = `${shape} - ${km.toFixed(1)} km`
    const pts = result.segments
      .flatMap((s) => s.pts)
      .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
    return {
      xml: buildGpx({
        name,
        desc: `Target ${(targetM / 1000).toFixed(1)} km ±${tol * 100}%. Actual ${km.toFixed(1)} km (drawing ${(result.drawingM / 1000).toFixed(1)} km, transit ${(result.transitM / 1000).toFixed(1)} km). Map data © OpenStreetMap contributors.`,
        pts,
        kind,
      }),
      name,
      file: gpxFileName(shape, km),
    }
  }, [result, shape, kind, targetM, tol])

  function useMyLocation() {
    setLocMsg('Locating…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ ll: [p.coords.latitude, p.coords.longitude], label: 'My location' })
        setLocMsg('')
      },
      () => setLocMsg('Location blocked — search for a place or tap the map instead.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLocMsg('Searching…')
    try {
      const r = await searchPlaces(query)
      setPlaces(r)
      setLocMsg(r.length ? '' : 'No matches.')
    } catch (err) {
      setLocMsg(err instanceof Error ? err.message : 'Search failed.')
    }
  }

  function cancel() {
    abort.current?.abort()
    worker.current?.terminate()
    worker.current = null
    setBusy(null)
  }

  async function generate() {
    if (!prep || !loc) return
    setError('')
    setResult(null)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      setBusy('Loading streets…')
      // Drawing can't be wider than D / unitLen; allow for rotation, offsets and a margin.
      const half = Math.min(20_000, 0.75 * (targetM / prep.unitLen) + 400)
      const elements = await fetchElements(bboxAround(loc.ll, half), ctl.signal)
      setBusy('Fitting route…')
      const w = new Worker(new URL('../worker/routeWorker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      w.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        if (m.type === 'progress') setBusy(`Fitting route… ${m.done}/${m.total}`)
        else if (m.type === 'best') setResult(m.result)
        else {
          w.terminate()
          worker.current = null
          setBusy(null)
          if (m.type === 'error') setError(m.message)
          else if (m.result) {
            setResult(m.result)
            setView('map')
          } else setError('Could not fit the drawing here. Try another spot, a bigger distance, or a simpler shape.')
        }
      }
      w.onerror = () => {
        w.terminate()
        setBusy(null)
        setError('Routing failed unexpectedly.')
      }
      w.postMessage({ elements, strokes, center: loc.ll, targetM, tol })
    } catch (err) {
      setBusy(null)
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const km = (m: number) => (m / UNIT_M[unit]).toFixed(1)
  const ready = !!prep && !!loc
  const hint = !prep ? 'Draw something' : !loc ? 'Set a location (⚙)' : ''

  return (
    <div className="screen">
      <header className="bar">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'draw'} onClick={() => setView('draw')}>
            ✏️ Draw
          </button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            🗺️ Map
          </button>
        </div>
        <button aria-pressed={sheet} onClick={() => setSheet(!sheet)} aria-label="Settings">
          ⚙️ Settings
        </button>
      </header>

      <div className="stage">
        {view === 'draw' ? (
          <div className="draw">
            <div className="bar">
              <input
                className="text"
                value={text}
                maxLength={8}
                placeholder="Word"
                aria-label="Text to draw"
                onChange={(e) => setText(e.target.value.toUpperCase())}
              />
              <button
                disabled={!text.trim()}
                onClick={() => {
                  setStrokes(textStrokes(text))
                  setShape(text.trim())
                }}
              >
                Write
              </button>
              <button disabled={!strokes.length} onClick={() => setStrokes(strokes.slice(0, -1))}>
                Undo
              </button>
              <button
                disabled={!strokes.length}
                onClick={() => {
                  setStrokes([])
                  setShape('drawing')
                }}
              >
                Clear
              </button>
            </div>
            <DrawCanvas
              strokes={strokes}
              onChange={(s) => {
                setStrokes(s)
                setShape('drawing')
              }}
            />
          </div>
        ) : (
          <Suspense fallback={<div className="center">Loading map…</div>}>
            <MapView
              pin={loc?.ll ?? null}
              onPin={(ll) => setLoc({ ll, label: 'Dropped pin' })}
              preview={preview}
              result={result}
            />
          </Suspense>
        )}

        {sheet && (
          <section className="sheet">
            <h2>Location</h2>
            <button onClick={useMyLocation}>📍 Use my location</button>
            <form className="row" onSubmit={search}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a place"
                aria-label="Search a place"
              />
              <button>Search</button>
            </form>
            {locMsg && <p className="muted">{locMsg}</p>}
            <ul className="places">
              {places.map((p) => (
                <li key={`${p.lat},${p.lon}`}>
                  <button
                    onClick={() => {
                      setLoc({ ll: [p.lat, p.lon], label: p.name })
                      setPlaces([])
                      setView('map')
                      setSheet(false)
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">
              {loc ? `📌 ${loc.label} (${loc.ll[0].toFixed(4)}, ${loc.ll[1].toFixed(4)})` : 'No location yet.'} You can also tap the
              map to drop a pin.
            </p>

            <h2>Distance</h2>
            <div className="row">
              <input
                type="number"
                min={1}
                max={MAX[unit]}
                step={0.5}
                value={dist}
                aria-label="Target distance"
                onChange={(e) => setDist(Math.min(MAX[unit], Math.max(0, +e.target.value)))}
              />
              <select
                value={unit}
                aria-label="Unit"
                onChange={(e) => {
                  const u = e.target.value as 'km' | 'mi'
                  setDist(+((dist * UNIT_M[unit]) / UNIT_M[u]).toFixed(1))
                  setUnit(u)
                }}
              >
                <option value="km">km</option>
                <option value="mi">mi</option>
              </select>
              <select value={tol} aria-label="Tolerance" onChange={(e) => setTol(+e.target.value)}>
                <option value={0.05}>±5%</option>
                <option value={0.1}>±10%</option>
                <option value={0.2}>±20%</option>
              </select>
            </div>
            <input
              type="range"
              min={1}
              max={MAX[unit]}
              step={0.5}
              value={dist}
              aria-label="Target distance slider"
              onChange={(e) => setDist(+e.target.value)}
            />
            <label className="row">
              Pace (min/{unit})
              <input type="number" min={2} max={20} step={0.1} value={pace} onChange={(e) => setPace(+e.target.value)} />
            </label>
            {minM > targetM && (
              <p className="warn">
                This drawing has a lot of detail for {dist} {unit}. Try ≥ {km(minM)} {unit} or a simpler shape.
              </p>
            )}

            <h2>Export</h2>
            <label className="row">
              GPX type
              <select value={kind} onChange={(e) => setKind(e.target.value as 'trk' | 'rte')}>
                <option value="trk">Track (&lt;trk&gt;) — default</option>
                <option value="rte">Route (&lt;rte&gt;)</option>
              </select>
            </label>
            <details open={!!result}>
              <summary>How to load on your watch</summary>
              <ul>
                <li>
                  <b>COROS:</b> COROS app → Profile → Import Data → Import Route (GPX), then sync to the watch (Navigation → Routes).
                </li>
                <li>
                  <b>Garmin:</b> import as a course in Garmin Connect, then send to device.
                </li>
                <li>
                  <b>Suunto / Polar:</b> import via the companion app&apos;s route import, then sync.
                </li>
                <li>
                  <b>Apple Watch / Wear OS:</b> use a GPX-capable nav app (e.g. WorkOutDoors).
                </li>
                <li>
                  <b>Strava:</b> import the GPX as a route.
                </li>
              </ul>
            </details>
            <p className="muted">
              Routes are auto-generated: obey traffic laws and check paths are safe and accessible. Map data © OpenStreetMap contributors.
            </p>
          </section>
        )}
      </div>

      <footer className="foot">
        {error && <p className="warn">{error}</p>}
        {result && !busy && (
          <p className="stats">
            <b>
              {km(result.lengthM)} {unit}
            </b>{' '}
            (target {dist} {unit} ±{tol * 100}%) · score {result.score} · ~{Math.round((result.lengthM / UNIT_M[unit]) * pace)} min
            <br />
            <span className="muted">
              drawing {km(result.drawingM)} · transit {km(result.transitM)} · shape {Math.round(result.fidelity * 100)}% · distance{' '}
              {Math.round(result.distFit * 100)}%
            </span>
            {!result.withinTol && <span className="warn"> Outside tolerance — adjust distance or tolerance.</span>}
          </p>
        )}
        <div className="bar">
          {busy ? (
            <>
              <span className="grow">{busy}</span>
              <button onClick={cancel}>Cancel</button>
            </>
          ) : result && gpx ? (
            <>
              <button
                className="primary"
                onClick={() => {
                  shareOrDownload(gpx.xml, gpx.file, gpx.name, false)
                  setSheet(true)
                }}
              >
                ⬇ Download GPX
              </button>
              {canShare && (
                <button onClick={() => shareOrDownload(gpx.xml, gpx.file, gpx.name, true)}>Send to watch app</button>
              )}
              <button onClick={() => void generate()}>Redo</button>
            </>
          ) : (
            <>
              <button className="primary" disabled={!ready} onClick={() => void generate()}>
                Generate route
              </button>
              {hint && <span className="muted">{hint}</span>}
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
