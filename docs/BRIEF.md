# GPS Art Route Generator — Technical & Deployment Strategy

**Purpose of this document:** hand-off spec for a developer building a web app that turns a user's drawing (or typed word) into a followable GPX route on real streets, so they can run/ride it and upload the resulting "GPS art" to Strava.

---

## 1. Product Summary

1. User draws a shape with a pencil tool **or** types a word on an HTML `<canvas>`.
2. User picks a location (current GPS location or a searched/dropped pin) and a **target run distance** (e.g. "10 km ± 10%"). Distance is a primary constraint: the drawing is scaled so the final route length matches it (see §4.9).
3. The app converts the drawing into a geographic polyline, snaps it to the OpenStreetMap (OSM) road/path network, and uses **Dijkstra's algorithm** to connect the snapped points into one continuous, followable route.
4. The app shows the route over the map with a "fidelity score," then exports a **GPX** file.
5. User imports the GPX into Strava (or a watch/phone nav app), follows it, and the recorded activity draws the image.

**Constraint:** free tools only — no paid map, geocoding, or routing APIs.

---

## 2. Tech Stack (all free)

| Concern | Choice | Notes |
|---|---|---|
| Build tooling | Vite + TypeScript | Fast dev server, static output |
| UI | Vanilla TS (or Preact if preferred) | App is small; framework optional |
| Drawing | Native Canvas 2D API + Pointer Events | Required by spec |
| Map display | Leaflet + OSM raster tiles | Must show OSM attribution |
| Road network data | Overpass API | Query ways within a bounding box |
| Geocoding (search) | Nominatim | Max 1 req/sec, debounce input |
| Current location | Browser Geolocation API | Requires HTTPS |
| Spatial index | `kdbush` (+ `geokdbush`) | Nearest-node lookups |
| Priority queue | `tinyqueue` or a small custom binary heap | For Dijkstra |
| Single-stroke font | Hershey font data (e.g. `hersheytext` package) | See §4.2 — critical for text |
| Heavy compute | Web Worker | Keeps UI responsive |
| Hosting | Cloudflare Pages / Netlify / Vercel (free tier) | Static site |
| Optional proxy | Cloudflare Worker (free tier) | Caches Overpass responses |
| CI | GitHub Actions | Lint, test, build, deploy |

---

## 3. High-Level Architecture

```
┌───────────────────────── Browser (static site) ─────────────────────────┐
│                                                                          │
│  Canvas UI ──► Stroke capture ──► Simplify/Resample ──► Stroke ordering  │
│                                                              │           │
│  Leaflet map ◄── Location picker (Geolocation / Nominatim)   ▼           │
│       ▲                                             Project to lat/lon   │
│       │                                                      │           │
│       │         ┌──────────── Web Worker ─────────────┐      ▼           │
│       │         │ Build graph ◄── Overpass JSON        │                  │
│       │         │ Snap anchors to nodes (kdbush)       │                  │
│       │         │ Dijkstra between anchors             │                  │
│       │         │ Fit search (scale/rotate/offset)     │                  │
│       │         │ Score fidelity                       │                  │
│       │         └──────────────────────────────────────┘                  │
│       └──────── Route preview + score ──► GPX export (download)          │
└──────────────────────────────────────────────────────────────────────────┘
                 │ (optional)
                 ▼
     Cloudflare Worker proxy ──► Overpass API (cached by bbox tile)
```

**Phase 1 is 100% client-side.** No backend required. A proxy is added only if Overpass rate limits become a problem.

---

## 4. Processing Pipeline (core algorithm)

### 4.1 Drawing capture (Canvas)

- Use Pointer Events (`pointerdown/move/up`) so mouse, touch, and stylus all work. Call `setPointerCapture`.
- Store data as vectors, not pixels:

```ts
type Pt = { x: number; y: number };
type Stroke = Pt[];
type Drawing = { strokes: Stroke[]; width: number; height: number };
```

- Scale canvas for `devicePixelRatio` so lines are crisp on mobile.
- Provide: pencil, undo (pop last stroke), clear, and "text mode".

#### 4.1.1 Mobile: no scrolling, panning, zooming, or overflow while drawing

**Requirement:** on phones and tablets, touching the canvas must only draw. The page must never scroll, bounce, pinch-zoom, pull-to-refresh, or trigger browser gestures, and the canvas must never overflow its container or the viewport.

**Viewport and layout**

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

- **Draw screen:** make it a fixed, full-height layout, not a scrolling document. Use `height: 100dvh` (with a `100vh` fallback) so iOS/Android address bars don't cause overflow.
- **Grid:** lay the screen out as toolbar / canvas / action bar. The canvas cell gets `min-height: 0; overflow: hidden;` so it can shrink without pushing content off-screen.
- **Safe areas:** pad the toolbar and action bar with `env(safe-area-inset-*)` so controls clear the notch and home indicator. The canvas itself should never sit under them.

```css
html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
.draw-screen {
  height: 100vh; height: 100dvh;
  display: grid; grid-template-rows: auto 1fr auto;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  box-sizing: border-box;
}
.canvas-wrap { position: relative; min-height: 0; overflow: hidden; }
canvas {
  display: block;               /* removes inline baseline gap that causes 4px overflow */
  width: 100%; height: 100%;
  touch-action: none;           /* no pan, pinch-zoom, or double-tap zoom on the canvas */
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none;  /* no iOS long-press menu */
  -webkit-tap-highlight-color: transparent;
}
```

**Event handling**

- `touch-action: none` on the canvas is the primary fix. Also call `preventDefault()` in `pointerdown`/`pointermove` as a backstop.
- **Older iOS Safari:** add `touchstart`/`touchmove` listeners with `{ passive: false }` and call `preventDefault()`, because passive listeners can't block scrolling.
- Use `setPointerCapture(e.pointerId)` so a stroke that drags past the canvas edge keeps drawing instead of scrolling the page.
- Use `e.getCoalescedEvents()` where available for smooth lines on high-refresh screens.
- **Palm rejection:** track only one active `pointerId` per stroke. If a stylus is present (`pointerType === 'pen'`), optionally ignore `touch` input.
- Handle `pointercancel` by ending the stroke cleanly, so an OS gesture that interrupts doesn't leave a broken stroke.

```ts
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
canvas.addEventListener('pointerdown', e => {
  if (activePointer !== null) return;          // ignore second finger / palm
  activePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
  startStroke(toCanvasPt(e));
});
```

**Sizing and resize**

- Size the backing store from the container using a `ResizeObserver`: `canvas.width = rect.width * dpr`, `canvas.height = rect.height * dpr`. Never set CSS sizes larger than the container.
- **Store strokes in normalized coordinates** (0–1 of canvas width/height) and redraw on resize. Then rotating the phone, or the keyboard opening in text mode, never clips or distorts the drawing.
- Keep a fixed drawing aspect ratio (e.g. square, letterboxed inside the container) so the shape doesn't stretch between portrait and landscape.
- **Text mode:** the on-screen keyboard shrinks the visual viewport. Put the text input in the toolbar, listen to `visualViewport` resize, and avoid focusing inputs that make iOS scroll the page. The input's `font-size` must be ≥ 16px, or iOS auto-zooms.

**Screen flow**

- The drawing screen and the map screen are **separate views**, not one long scrolling page. This removes any conflict between canvas drawing and page scrolling.
- The Leaflet map needs its own gestures (pan/zoom). Keep the map in its own view, and disable Leaflet's `tap` and `dragging` only if a map is ever shown behind the canvas.

**Acceptance criteria**

- Drawing anywhere on the canvas, including fast strokes starting at or crossing the edges, produces no page scroll, bounce, zoom, or pull-to-refresh on iOS Safari, Android Chrome, and Samsung Internet.
- `document.documentElement.scrollHeight === window.innerHeight` on the draw screen in portrait and landscape, with and without the keyboard open.
- No horizontal scrollbar at 320px width.
- Long-press shows no context menu or text-selection handles.
- Rotating the device preserves the drawing without clipping.

### 4.2 Text input — use a single-stroke font

GPS art must be a **line you can walk**, not an outlined glyph. Regular fonts (via `fillText`) produce outlines, which would route you around the *edge* of each letter.

- **Primary approach:** render text from a **Hershey single-stroke font**. Each glyph is a set of polylines; offset them per character and feed them in as strokes.
- **Fallback:** `fillText` onto an offscreen canvas → threshold → Zhang-Suen skeletonization → trace pixel skeleton into polylines. Noisier; use only if needed.
- Recommend limiting text to ~8 characters and uppercase; long words at walkable scale get very long.

### 4.3 Simplify and resample

1. **Ramer–Douglas–Peucker** simplification (epsilon ≈ 1–2% of drawing diagonal) to strip hand jitter.
2. **Resample** each stroke to evenly spaced "anchor" points. Spacing is set in *real-world meters* after scaling (target ≈ 50–100 m, roughly one city block). These anchors are the "integral nodes" of the drawing.

### 4.4 Stroke ordering (making one continuous line)

A drawing usually has multiple strokes, but a GPS track is one line. Solve:

1. Treat each stroke as an item that can be traversed forward or reversed.
2. Order strokes with **greedy nearest-endpoint**, then improve with **2-opt**.
3. Gaps between strokes become **"transit" segments** — routed by pure shortest path (plain Dijkstra, no shape penalty) and flagged so the preview can draw them dashed.

Tip for the UI: tell users that single-stroke drawings produce the cleanest results.

### 4.5 Projection to geographic coordinates

Given a center `(lat0, lon0)`, target width in meters `W`, and rotation `θ`:

```ts
const M_PER_DEG_LAT = 111_320;
function toLatLon(p: Pt, d: Drawing, lat0: number, lon0: number, W: number, theta: number) {
  const s = W / d.width;                             // meters per canvas px
  let dx = (p.x - d.width / 2) * s;
  let dy = (d.height / 2 - p.y) * s;                 // flip y (canvas y grows downward)
  [dx, dy] = [dx * Math.cos(theta) - dy * Math.sin(theta),
              dx * Math.sin(theta) + dy * Math.cos(theta)];
  return {
    lat: lat0 + dy / M_PER_DEG_LAT,
    lon: lon0 + dx / (M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180)),
  };
}
```

A local equirectangular projection is accurate enough at the scale of a run/ride (< 50 km).

`W` is not entered by the user directly. It is derived from the target distance (§4.9). Initial estimate: `W₀ = W_canvas × (D_target / L_canvas)`, where `L_canvas` is the total drawing length in canvas px (strokes + straight-line gaps between them) and `W_canvas` is the canvas width in px.

### 4.6 Fetching the OSM graph (Overpass)

Query the bounding box of the projected drawing plus a ~20% margin. Filter by activity type:

```
[out:json][timeout:25];
(
  way["highway"~"^(footway|path|pedestrian|residential|living_street|service|tertiary|secondary|unclassified|track|cycleway|steps)$"]
     ["access"!~"private|no"]
     ({{south}},{{west}},{{north}},{{east}});
);
(._;>;);
out skel qt;
```

- **Run/walk mode:** include footways, paths, steps; exclude motorways/trunks.
- **Bike mode:** include cycleways; exclude steps and `bicycle=no`.
- Respect `oneway` tags only in bike mode.
- Cache responses (IndexedDB) keyed by rounded bbox to avoid refetching while the user tweaks the fit.

**Build the graph:**

```ts
type Graph = {
  nodes: Float64Array;            // [lat0, lon0, lat1, lon1, ...] indexed by internal id
  adj: Array<Array<{ to: number; w: number }>>; // w = haversine meters
  osmIdToIdx: Map<number, number>;
};
```

Keep only the largest connected component so routing never hits islands.

### 4.7 Snapping anchors to the network

- Build a `kdbush` index over graph nodes.
- For each anchor, take the nearest node (`geokdbush.around`, limit 1–3).
- Collapse consecutive duplicate snapped nodes.
- Optional improvement: snap to the nearest point on an **edge**, not just a node, for better accuracy on long blocks.

### 4.8 Routing with Dijkstra (shape-aware cost)

Route between each consecutive pair of snapped anchors. Plain shortest path will "cut corners," so use a **shape-aware edge cost**:

```
cost(edge) = length(edge) × (1 + α × deviation(edge) / spacing)
```

- `deviation(edge)` = distance from the edge midpoint to the *target* drawing segment between the two anchors.
- `α` ≈ 2–5 (tunable). Higher = sticks closer to the drawing, lower = shorter route.
- For **transit segments** (§4.4) use `α = 0`.
- Early-exit Dijkstra when the target node is popped. Bound the search area to a buffer around the segment for speed.
- A* with a haversine heuristic is a drop-in speedup; it stays correct because cost ≥ length.

Concatenate all sub-paths (drop duplicated join nodes) into the final route.

### 4.9 Distance targeting (hard constraint)

Runners plan around distance, so the route length must land within a user-set tolerance of their target.

**Inputs (UI):**

- Target distance `D_target` (km or mi, with a unit toggle), via slider plus numeric input.
- Tolerance (default ±10%; presets ±5%, ±10%, ±20%).
- Optional pace, used to show an estimated duration.
- Toggle: *count transit segments toward distance* (default **on**, because the runner still has to cover them).

**Why it isn't a single calculation:** snapped, routed length is always longer than the drawn length. Street detours, the shape-aware cost, and transit segments all add distance. The inflation factor (typically 1.15–1.6×) depends on the local grid, so it has to be measured, not assumed.

**Algorithm — solve for scale:**

1. Start with `W₀` from §4.5.
2. Run snap + route and measure the actual routed length `L(W)`.
3. Update scale with a secant/proportional step: `W₁ = W₀ × D_target / L(W₀)`.
4. Repeat until `|L − D_target| / D_target ≤ tolerance`. This usually converges in 2–4 iterations because length is roughly linear in scale.
5. If it doesn't converge (the length jumps discontinuously as routes snap to different streets), fall back to evaluating a small bracket of scales and picking the closest one within tolerance.

**Fine-tuning without rescaling:**

- If the route is slightly short, optionally add a closing segment back to the start (loop mode). This only adds distance.
- If the route is slightly long, raise `α` a little: tighter tracking often trims detours.

**Constraints and edge cases:**

- **Minimum viable distance:** each drawing has a floor below which detail collapses, because anchors get closer together than city blocks. Estimate it as `(anchor count × ~60 m block size)`. Warn the user if `D_target` is below it and suggest simplifying the drawing or increasing distance.
- **Maximum distance:** cap the bbox size (e.g. 40 km across) to keep Overpass queries reasonable.
- **Changing distance later:** re-run the scale solver using the cached graph. If the new bbox exceeds the cached one, fetch only the extra area.
- **Out-and-back / start point:** if the user sets a fixed start point (e.g. home), include the distance to and from the drawing's start in the total (toggleable).

**Output shown to the user:** actual distance, delta vs target, drawing distance vs transit distance breakdown, and estimated time at their pace.

### 4.10 Fit optimization (big quality win)

Where a drawing lands on the street grid matters more than anything else. Automate the search, **with distance as a constraint**:

- Grid-search over **rotation** (−30° to +30° in 5° steps) and **offset** (± a few blocks). For each candidate, **scale is solved by §4.9**, not grid-searched freely.
- Discard candidates that can't reach the distance tolerance.
- For each surviving candidate: snap + route + score. Fetch the graph once for the largest bbox and reuse it.
- Run in the Web Worker; stream the best result back as it improves.
- Let the user also drag/rotate manually on the map and re-run. Distance stays locked unless they change it.

### 4.11 Scoring

Score how well the route matches the drawing **and** the distance goal:

- **Shape fidelity:** mean two-way deviation between the route and the target polyline, plus **discrete Fréchet distance** as a stricter "shape" measure.
- **Distance fit:** `1 − |L − D_target| / (D_target × tolerance)`, clamped to 0–1.
- **Combined score** (0–100): `w_shape × fidelity + w_dist × distanceFit`. Suggested defaults are 0.7 / 0.3. Candidates outside the tolerance are rejected outright, so distance acts as a hard constraint and a tie-breaker.
- Show both sub-scores so users understand the trade-off: a tighter distance tolerance can lower shape fidelity.

### 4.12 GPX export

Output GPX 1.1 with a track (widest compatibility; Strava route import accepts it):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPS Art Generator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Heart - 6.2 km</name><desc>Target 6.0 km ±10%. Actual 6.2 km (drawing 5.7 km, transit 0.5 km)</desc></metadata>
  <trk>
    <name>Heart - 6.2 km</name>
    <trkseg>
      <trkpt lat="40.7128" lon="-74.0060"/>
      <!-- ... -->
    </trkseg>
  </trk>
</gpx>
```

Trigger download with a `Blob` + `URL.createObjectURL`. Also offer a `<rte>` variant for devices that prefer routes.

#### 4.12.1 Downloadable, watch-ready GPX (hard requirement)

**Requirement:** the user must be able to save the GPX file to their device, from both desktop and mobile browsers, and load it onto a GPS watch for turn-by-turn / breadcrumb navigation during the run.

**Download implementation**

```ts
function downloadGpx(gpx: string, name: string) {
  const file = new File([gpx], `${safeName(name)}.gpx`, { type: 'application/gpx+xml' });

  // Mobile: native share sheet lets the user send straight to Garmin Connect, COROS, Suunto, Files, etc.
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => fallbackDownload(file));
    return;
  }
  fallbackDownload(file);
}

function fallbackDownload(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // revoke late: iOS needs the URL alive briefly
}
```

**UI**

- Provide two clear buttons: **"Download GPX"** (always a plain file save) and **"Send to watch app"** (share sheet, shown only when `navigator.canShare` supports files).
- The download must be triggered directly by the user's tap. Don't run it after an `await` on long work, or Safari may block it. Generate the GPX first, then enable the button.
- Filename format: `gps-art_<shape>_<distance>km_<yyyy-mm-dd>.gpx`, restricted to ASCII letters, numbers, `-`, and `_`.
- After download, show a short **"How to load on your watch"** panel (see below).
- Keep the last few generated routes in IndexedDB so the user can re-download without regenerating.

**Watch compatibility**

- **Track choice:** default to `<trk>` for navigation. Garmin Connect, COROS, Suunto, and most apps import a track as a course/route. Keep `<rte>` as an alternate export option.
- **Point count limits:** some watches and apps cap how many points a course can have and silently truncate longer files. Downsample with RDP on the final geographic route to a configurable maximum (default ~1,000 points). Always keep points at every turn so the path never cuts through buildings.
- **Elevation:** optionally add `<ele>` per point (from a free elevation source, or omit). Not required for navigation.
- **Turn cues (optional):** add `<wpt>` entries at sharp turns (e.g. > 60° heading change) with names like "Turn left". Many devices generate their own turn prompts from the track, so keep this toggleable.
- **Closed loops:** if loop mode is on, make sure the last point equals the first, so watches show the course as a loop.
- **Validation:** validate output against the GPX 1.1 XSD in tests. Escape XML in names. Use 6–7 decimal places for coordinates, `.` as the decimal separator regardless of locale, and UTF-8 with no BOM.

**"Load on your watch" guidance to show users** (keep concise; link to each vendor's own help pages, since their steps change over time)

- **Garmin:** import the GPX as a course in Garmin Connect (web or app), then send it to the device.
- **COROS / Suunto / Polar:** import via the companion app's route/course import, then sync.
- **Apple Watch / Wear OS:** use a navigation app that supports GPX import (e.g. WorkOutDoors on Apple Watch).
- **Strava:** import the GPX as a Strava route. Strava can sync routes to some connected devices.
- **No watch:** open the GPX in a phone navigation app that supports GPX tracks.

**Acceptance criteria**

- Tapping "Download GPX" saves a valid `.gpx` file on iOS Safari (to Files), Android Chrome (to Downloads), and desktop Chrome/Firefox/Safari/Edge.
- The share sheet, when available, lists installed watch companion apps as targets.
- The file imports without errors into Garmin Connect and Strava route import, and the imported course length matches the in-app distance within ~2%.
- No file exceeds the configured point cap, and no turn is lost by downsampling.

---

## 5. Location Selection

- **"Use my location"**: `navigator.geolocation.getCurrentPosition` — requires HTTPS, handle denial gracefully and fall back to search.
- **Search**: Nominatim `/search?format=json&q=...` — debounce ≥ 1 s, set a descriptive app identity (Referer on the browser side), cache results.
- **Manual**: click/drag a center pin on the Leaflet map.
- Show the drawing as a live overlay on the map before routing so users can position it.

---

## 6. Suggested Project Structure

```
/src
  /canvas      drawing.ts, textHershey.ts, tools.ts
  /geo         project.ts, haversine.ts, simplify.ts, resample.ts
  /osm         overpass.ts, buildGraph.ts, cache.ts
  /routing     dijkstra.ts, shapeCost.ts, strokeOrder.ts, distanceSolver.ts, fitSearch.ts, score.ts
  /export      gpx.ts
  /map         leafletMap.ts, locationPicker.ts
  /worker      routeWorker.ts          # hosts the routing pipeline
  main.ts
/tests         unit tests for geo, routing, gpx
/proxy         (optional) Cloudflare Worker for Overpass caching
```

---

## 7. Deployment Strategy

### Environments

| Env | Trigger | Host |
|---|---|---|
| Preview | Every pull request | Cloudflare Pages / Netlify preview URL |
| Production | Merge to `main` | Same platform, custom domain + HTTPS |

HTTPS is mandatory (Geolocation API is blocked on plain HTTP).

### CI pipeline (GitHub Actions)

1. `npm ci`
2. `npm run lint` (ESLint) + `tsc --noEmit`
3. `npm test` (Vitest) — unit tests for projection, RDP, Dijkstra, GPX output
4. `npm run build` (Vite → `/dist`)
5. Deploy `/dist` via the host's GitHub integration or CLI

### Configuration

Environment variables (build-time):

- `VITE_OVERPASS_URL` — defaults to a public Overpass instance; switch to proxy URL if added
- `VITE_NOMINATIM_URL`
- `VITE_TILE_URL`

### Optional proxy (Phase 2)

A Cloudflare Worker that forwards Overpass queries and caches responses (e.g. 24 h) keyed by rounded bbox. Reduces load on public Overpass servers and speeds up repeat users in the same area.

### Scaling path (only if traffic grows)

Public OSM services have fair-use limits and are not meant for heavy production load. If usage grows: self-host tiles (or use a free-tier tile provider), self-host Overpass or preprocess regional OSM extracts into graph files served from object storage.

---

## 8. Compliance & Attribution

- **OSM data (ODbL):** display "© OpenStreetMap contributors" on the map and include it in GPX `<metadata>`.
- **OSM tile usage policy:** no bulk downloading/prefetching; set proper attribution.
- **Nominatim usage policy:** max 1 request/sec, no autocomplete-per-keystroke, cache results.
- **Overpass:** keep queries bbox-limited and cached.
- **Safety disclaimer:** routes are auto-generated; users must obey traffic laws and check that paths are safe/accessible. Exclude private-access ways.

---

## 9. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| 1 | Canvas MVP | Pencil, undo, clear, vector stroke storage, mobile no-scroll/no-overflow layout (§4.1.1) |
| 2 | Map + location | Leaflet map, geolocation, Nominatim search, drawing overlay |
| 3 | Graph + snapping | Overpass fetch, graph build, nearest-node snapping, preview |
| 4 | Routing | Stroke ordering, shape-aware Dijkstra, continuous route |
| 4b | Distance targeting | Distance/tolerance UI, scale solver, min-distance warning, distance breakdown |
| 5 | Export | Downloadable + shareable GPX (§4.12.1), point-count downsampling, watch-loading guide, tested via Garmin Connect and Strava import |
| 6 | Text mode | Hershey single-stroke font rendering |
| 7 | Quality | Fit search, fidelity score, Web Worker, caching |
| 8 | Launch | CI/CD, production deploy, attribution, disclaimers |
| 9 | (Optional) | Overpass proxy, bike/run modes, loop-closing option |

---

## 10. Testing Plan

- **Unit:** projection round-trips, RDP output, Dijkstra on small hand-built graphs (known shortest paths), GPX schema validity, distance solver convergence on a synthetic grid (hits target within tolerance in ≤ 4 iterations).
- **Integration:** fixture Overpass JSON for a known city block → deterministic route snapshot.
- **Mobile device testing:** real iOS Safari, Android Chrome, and Samsung Internet devices, checked against the §4.1.1 acceptance criteria (portrait/landscape, keyboard open, edge-crossing strokes, two-finger and palm touches). Automate the overflow check with Playwright mobile emulation (assert no page scroll after simulated edge-to-edge drags).
- **Export testing:** download on iOS Safari, Android Chrome, and desktop browsers; import into Garmin Connect and Strava; sync to at least one real watch and follow a short test route. Unit-test GPX output against the GPX 1.1 XSD and the point-cap downsampler.
- **Manual:** draw simple shapes (square, heart, star) in a grid city vs an irregular city; import GPX into Strava and a watch app.
- **Performance targets:** graph build < 1 s and full fit search < 5 s for a ~5 km drawing on a mid-range phone.

---

## 11. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Street grid can't represent the shape well | Fit search over scale/rotation/offset; show score; suggest nearby grid-like areas |
| Multi-stroke drawings create messy connectors | Stroke ordering + dashed "transit" preview; encourage single-stroke |
| Outline fonts produce wrong routes | Hershey single-stroke fonts |
| Public API rate limits | Caching, debounce, optional proxy |
| Slow on mobile | Web Worker, bounded Dijkstra search, typed arrays |
| GPX won't download on mobile or is truncated on the watch | Web Share API with download fallback, user-gesture-triggered save, configurable point cap with turn-preserving downsampling |
| Page scrolls or zooms while drawing on mobile | `touch-action: none`, non-passive touch listeners, fixed `100dvh` layout, separate draw/map views |
| Route length misses target distance | Iterative scale solver, tolerance setting, loop-closing padding, reject out-of-tolerance candidates |
| Target distance too short for drawing detail | Minimum-distance estimate and warning; suggest simplifying the drawing |
| Routes through unsafe/private ways | Tag filters, disclaimer, activity-mode profiles |

---

## 12. Future Ideas

- Closed-loop option (start = finish) by routing the last anchor back to the first.
- Choose start point near a user-selected spot (e.g. home).
- Share link with drawing + location encoded in URL.
- Strava API integration (OAuth) to push routes directly — requires Strava developer app registration.
