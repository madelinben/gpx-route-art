import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { DrawCanvas } from '../components/DrawCanvas'
import { LoadBoundary } from '../components/LoadBoundary'
import type { Stroke } from '../canvas/drawing'
import { textStrokes } from '../canvas/hershey'
import { STAMPS } from '../canvas/shapes'
import { buildGpx, canShareFiles, gpxFileName, shareOrDownload } from '../export/gpx'
import type { LatLon } from '../geo/geo'
import { frame } from '../geo/geo'
import { searchPlaces } from '../osm/nominatim'
import type { Place } from '../osm/nominatim'
import { place, prepare } from '../routing/pipeline'
import type { RouteResult } from '../routing/solve'
import type { WorkerIn, WorkerOut } from '../worker/routeWorker'
import { rank, Variations } from '../components/Variations'
import type { MetricId } from '../components/Variations'

const MapView = lazy(() => import('../components/MapView'))

export const Route = createFileRoute('/')({ component: App })

const UNIT_M = { km: 1000, mi: 1609.344 }
const MAX = { km: 25, mi: 15 }
const MIN_M_PER_VERTEX = 60 // ~one city block of detail per drawing vertex
const INFLATION = 1.3 // rough preview: routed length ≈ 1.3× drawn length
const CONFETTI = ['🎉', '⭐', '✨', '🏃', '💥', '🎈', '🌟', '👟']

type Busy = { msg: string; pct?: number }

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
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RouteResult | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [party, setParty] = useState(0)
  const [areaKm, setAreaKm] = useState(10)
  const [variations, setVariations] = useState<RouteResult[]>([])
  const [metric, setMetric] = useState<MetricId>('score')
  const [varsOpen, setVarsOpen] = useState(true)
  const [note, setNote] = useState('')
  const worker = useRef<Worker | null>(null)

  const targetM = dist * UNIT_M[unit]
  const prep = useMemo(() => prepare(strokes), [strokes])
  const minM = prep ? prep.vertices * MIN_M_PER_VERTEX : 0

  // Real-world meters across the canvas square, for the dot grid: the drawing's widest side
  // is W meters wide (exact once routed, estimated before) and covers `ext` of the square.
  const mPerSquare = useMemo(() => {
    const pts = strokes.flat()
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const ext = pts.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0
    const W = result?.widthM ?? targetM / (prep?.unitLen ?? 4) / INFLATION
    return W / (ext > 0.05 ? ext : 0.8)
  }, [strokes, prep, targetM, result])

  // Any input change makes the shown route stale.
  useEffect(() => {
    setResult(null)
    setVariations([])
  }, [strokes, loc, targetM, tol, areaKm])
  useEffect(() => setCanShare(canShareFiles()), [])
  useEffect(() => {
    if (!party) return
    const t = setTimeout(() => setParty(0), 2400)
    return () => clearTimeout(t)
  }, [party])
  // A lazy chunk/CSS that fails to load (flaky network, or a redeploy replaced the hashed files):
  // reload once to pick up the fresh index; the boundary shows a Reload button if it still fails.
  useEffect(() => {
    const onErr = (e: Event) => {
      try {
        if (sessionStorage.getItem('preload-reloaded')) return
        sessionStorage.setItem('preload-reloaded', '1')
        e.preventDefault()
        location.reload()
      } catch {
        /* storage blocked: fall through to the boundary */
      }
    }
    window.addEventListener('vite:preloadError', onErr)
    return () => window.removeEventListener('vite:preloadError', onErr)
  }, [])
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
    const f = frame(loc.ll[0], loc.ll[1])
    const W = targetM / prep.unitLen / INFLATION
    return place(prep.strokes, W, 0, [0, 0]).map((s) => s.map((p) => f.toLatLon(p)))
  }, [prep, loc, targetM])

  const area = useMemo((): [LatLon, LatLon] | null => {
    if (!loc) return null
    const f = frame(loc.ll[0], loc.ll[1])
    const h = (areaKm * 1000) / 2
    return [f.toLatLon([-h, -h]), f.toLatLon([h, h])]
  }, [loc, areaKm])

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
        desc: `Target ${(targetM / 1000).toFixed(1)} km ±${Math.round(tol * 100)}%. Actual ${km.toFixed(1)} km (drawing ${(result.drawingM / 1000).toFixed(1)} km, transit ${(result.transitM / 1000).toFixed(1)} km). Map data © OpenStreetMap contributors.`,
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
        setSheet(false)
        setView('map')
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
    worker.current?.terminate() // also drops the tile cache; fine for an explicit cancel
    worker.current = null
    setBusy(null)
  }

  function showList(list: RouteResult[], m: MetricId) {
    setVariations(list)
    setResult(rank(list, m)[0] ?? null)
  }

  function generate() {
    if (!prep || !loc) return
    setError('')
    setNote('')
    setResult(null)
    setVariations([])
    setBusy({ msg: 'Starting…' })
    // One worker for the whole session so downloaded map tiles stay cached between searches.
    const w = (worker.current ??= new Worker(new URL('../worker/routeWorker.ts', import.meta.url), { type: 'module' }))
    let first = true
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data
      if (m.type === 'progress') {
        const msg = { tiles: 'Loading map tiles…', build: 'Building street map…', search: 'Searching the area…' }[m.phase]
        setBusy({ msg: `${msg} ${m.phase === 'build' ? '' : `${m.done}/${m.total}`}`, pct: m.phase === 'build' ? 1 : m.done / m.total })
      } else if (m.type === 'partial') {
        showList(m.list, metric)
        if (first) (setView('map'), (first = false))
      } else {
        setBusy(null)
        if (m.type === 'error') setError(m.message)
        else if (m.list.length) {
          showList(m.list, metric)
          setView('map')
          setParty((n) => n + 1)
          if (m.warning) setNote(m.warning)
        } else
          setError(`No spot in the area gave a route within ±${Math.round(tol * 100)}% of ${dist} ${unit}. Try a wider tolerance, another distance, or a simpler shape.`)
      }
    }
    w.onerror = () => {
      worker.current?.terminate()
      worker.current = null
      setBusy(null)
      setError('Routing failed unexpectedly.')
    }
    const msg: WorkerIn = { strokes, center: loc.ll, targetM, tol, areaM: areaKm * 1000 }
    w.postMessage(msg)
  }

  const km = (m: number) => (m / UNIT_M[unit]).toFixed(1)
  const stars = result ? Math.max(1, Math.round(result.score / 20)) : 0

  return (
    <div className="screen">
      <header className="top">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'draw'} onClick={() => setView('draw')}>
            ✏️ Draw
          </button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            🗺️ Map
          </button>
        </div>
        <button className="btn" aria-pressed={sheet} onClick={() => setSheet(!sheet)}>
          ⚙️ Settings
        </button>
      </header>

      <div className="stage">
        {view === 'draw' ? (
          <div className="draw">
            <div className="tools">
              <input
                className="text"
                value={text}
                maxLength={8}
                placeholder="Word"
                aria-label="Text to draw"
                onChange={(e) => setText(e.target.value.toUpperCase())}
              />
              <button
                className="btn sm"
                disabled={!text.trim()}
                onClick={() => {
                  setStrokes(textStrokes(text))
                  setShape(text.trim())
                }}
              >
                ✨ Write
              </button>
              <button
                className="btn sm"
                aria-label="Undo"
                title="Undo"
                disabled={!strokes.length}
                onClick={() => setStrokes(strokes.slice(0, -1))}
              >
                ↩
              </button>
              <button
                className="btn sm"
                aria-label="Clear"
                title="Clear"
                disabled={!strokes.length}
                onClick={() => {
                  setStrokes([])
                  setShape('drawing')
                }}
              >
                🗑
              </button>
            </div>
            <div className="stamps" aria-label="Shape stamps">
              {STAMPS.map((s) => (
                <button
                  key={s.id}
                  className="stamp"
                  aria-label={`${s.label} stamp`}
                  title={s.label}
                  onClick={() => {
                    setStrokes(s.strokes())
                    setShape(s.id)
                  }}
                >
                  {s.emoji}
                </button>
              ))}
            </div>
            <DrawCanvas
              strokes={strokes}
              mPerSquare={mPerSquare}
              onChange={(s) => {
                setStrokes(s)
                setShape('drawing')
              }}
            />
          </div>
        ) : (
          <LoadBoundary>
            <Suspense fallback={<div className="center">Loading map…</div>}>
              <MapView
                pin={loc?.ll ?? null}
                onPin={(ll) => setLoc({ ll, label: 'Dropped pin' })}
                preview={preview}
                result={result}
                area={area}
                bottomPad={variations.length && varsOpen ? 150 : 0}
              />
            </Suspense>
          </LoadBoundary>
        )}

        {view === 'map' && !loc && !sheet && <div className="tip">👆 Tap the map to drop a pin, or open ⚙️ Settings</div>}

        {view === 'map' && variations.length > 0 && !sheet && (
          <Variations
            list={variations}
            metric={metric}
            onMetric={(id) => {
              setMetric(id)
              setResult(rank(variations, id)[0])
            }}
            selected={result}
            onSelect={setResult}
            open={varsOpen}
            onToggle={() => setVarsOpen(!varsOpen)}
          />
        )}

        {sheet && (
          <section className="sheet">
            <div className="sheet-head">
              <h1>GPS Art</h1>
              <button className="btn sm" onClick={() => setSheet(false)}>
                ✕ Done
              </button>
            </div>

            <div className="card">
              <h2>📍 Where?</h2>
              <button className="btn blue" onClick={useMyLocation}>
                Use my location
              </button>
              <form className="row" onSubmit={search}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a place"
                  aria-label="Search a place"
                />
                <button className="btn">Go</button>
              </form>
              {locMsg && <p className="muted">{locMsg}</p>}
              <ul className="places">
                {places.map((p) => (
                  <li key={`${p.lat},${p.lon}`}>
                    <button
                      className="btn"
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
                {loc ? `📌 ${loc.label} (${loc.ll[0].toFixed(4)}, ${loc.ll[1].toFixed(4)})` : 'No spot picked yet.'} You can also tap
                the map to drop a pin.
              </p>
            </div>

            <div className="card">
              <h2>📏 How far?</h2>
              <div className="big">
                {dist} <small>{unit}</small>
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
              <label className="row">
                Search area
                <select value={areaKm} onChange={(e) => setAreaKm(+e.target.value)}>
                  <option value={3}>3 × 3 km (fast)</option>
                  <option value={6}>6 × 6 km</option>
                  <option value={10}>10 × 10 km (best shapes, slower first time)</option>
                </select>
              </label>
              <label className="row">
                Pace (min/{unit})
                <input type="number" min={2} max={20} step={0.1} value={pace} onChange={(e) => setPace(+e.target.value)} />
              </label>
              {minM > targetM && (
                <p className="warn">
                  🤏 That&apos;s a lot of detail for {dist} {unit}. Try ≥ {km(minM)} {unit} or a simpler shape.
                </p>
              )}
            </div>

            <div className="card">
              <h2>⌚ Export</h2>
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
                    <b>COROS:</b> COROS app → Profile → Import Data → Import Route (GPX), then sync to the watch (Navigation →
                    Routes).
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
            </div>
            <p className="muted fine">
              Routes are auto-generated: obey traffic laws and check paths are safe and accessible. Map data © OpenStreetMap
              contributors.
            </p>
          </section>
        )}

        {party > 0 && (
          <div className="confetti" key={party} aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <span
                key={i}
                style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 5) * 0.08}s`, '--r': `${(i * 53) % 360}deg` } as React.CSSProperties}
              >
                {CONFETTI[i % CONFETTI.length]}
              </span>
            ))}
          </div>
        )}
      </div>

      <footer className="foot">
        {error && <p className="warn">⚠️ {error}</p>}
        {note && <p className="warn">ℹ️ {note}</p>}
        {result && !busy && (
          <div className="stats">
            <div className="stats-top">
              <span className="big">
                {km(result.lengthM)} <small>{unit}</small>
              </span>
              <span className="stars" aria-label={`${stars} of 5 stars`}>
                {'★'.repeat(stars)}
                <span className="dim">{'★'.repeat(5 - stars)}</span>
              </span>
              <span className="muted">~{Math.round((result.lengthM / UNIT_M[unit]) * pace)} min</span>
            </div>
            <div className="chips">
              <span className="chip">🎯 target {dist} {unit} ±{Math.round(tol * 100)}%</span>
              <span className="chip">✏️ drawing {km(result.drawingM)}</span>
              <span className="chip">🚶 transit {km(result.transitM)}</span>
              <span className="chip">🔷 shape {Math.round(result.fidelity * 100)}%</span>
              <span className="chip">🧼 clean {Math.round(result.clean * 100)}%</span>
            </div>
            {!result.withinTol && <p className="warn">Outside tolerance — adjust distance or tolerance.</p>}
          </div>
        )}
        <div className="actions">
          {busy ? (
            <>
              <div className="progress" role="progressbar" aria-label={busy.msg}>
                <div className="bar-fill" style={{ width: `${Math.round((busy.pct ?? 0.08) * 100)}%` }} />
                <span>{busy.msg}</span>
              </div>
              <button className="btn" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : result && gpx ? (
            <>
              <button
                className="btn blue grow"
                onClick={() => {
                  shareOrDownload(gpx.xml, gpx.file, gpx.name, false)
                  setSheet(true)
                }}
              >
                ⬇ Download GPX
              </button>
              {canShare && (
                <button className="btn" onClick={() => shareOrDownload(gpx.xml, gpx.file, gpx.name, true)}>
                  ⌚ Send
                </button>
              )}
              <button className="btn" onClick={generate}>
                🔁 Redo
              </button>
            </>
          ) : (
            <button
              className={`btn green grow ${prep && loc ? 'pulse' : ''}`}
              disabled={!prep}
              onClick={() => (loc ? generate() : setSheet(true))}
            >
              {!prep ? '✏️ Draw something first' : !loc ? '📍 Choose a spot' : '🚀 Find best spots'}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
