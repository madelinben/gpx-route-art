import type { LatLon, XY } from '../geo/geo'
import { dist, distToPolyline, frame, polyLen, resample } from '../geo/geo'
import type { Eval, Prepared } from './pipeline'
import { evaluate } from './pipeline'
import type { Graph } from './graph'
import { nearestK } from './graph'

export type Measure = {
  lengthM: number
  drawingM: number
  transitM: number
  fidelity: number // 0–1, shape match
  distFit: number // 0–1
  errPct: number // |L − D| / D
  clean: number // 0–1, share of the route that never doubles back
  score: number // 0–100
}

export type RouteResult = Measure & {
  segments: { pts: LatLon[]; transit: boolean }[]
  withinTol: boolean
  widthM: number
  rotationDeg: number
  /** Where the drawing's center sits relative to the search center, in meters (east, north). */
  off: XY
}

export type SearchOpts = {
  targetM: number
  tol: number // e.g. 0.1
  center: LatLon
  /** Side of the square search area, meters. */
  areaM: number
  onProgress?: (done: number, total: number) => void
  /** Called with the current best variations after the coarse pass. */
  onPartial?: (r: RouteResult[]) => void
  /** Wall-clock budget for the whole search. */
  budgetMs?: number
}

type Cand = { theta: number; off: XY; W: number; m: Measure }

function meanDev(a: XY[], b: XY[], step: number) {
  const s = resample(a, step)
  return s.reduce((t, p) => t + distToPolyline(p, b), 0) / s.length
}

/** Discrete Fréchet distance between two polylines (both resampled to ≤ n points). */
function frechet(a: XY[], b: XY[], n = 80) {
  const p = resample(a, Math.max(1, polyLen(a) / n))
  const q = resample(b, Math.max(1, polyLen(b) / n))
  const ca = Array.from({ length: p.length }, () => new Float64Array(q.length))
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      const d = dist(p[i], q[j])
      ca[i][j] =
        i === 0 && j === 0
          ? d
          : Math.max(
              d,
              Math.min(
                i > 0 ? ca[i - 1][j] : Infinity,
                j > 0 ? ca[i][j - 1] : Infinity,
                i > 0 && j > 0 ? ca[i - 1][j - 1] : Infinity,
              ),
            )
    }
  }
  return ca[p.length - 1][q.length - 1]
}

function measure(g: Graph, ev: Eval, W: number, D: number, tol: number): Measure {
  const xy = (n: number): XY => [g.xy[2 * n], g.xy[2 * n + 1]]
  const route = ev.pieces.flatMap((p) => p.nodes.map(xy))
  const dev = (meanDev(route, ev.target, 25) + meanDev(ev.target, route, 25)) / 2
  const fr = frechet(route, ev.target)
  const fidelity = 0.5 * Math.exp(-dev / (0.08 * W)) + 0.5 * Math.exp(-fr / (0.2 * W))

  // doubling back: length of edges walked more than once
  const seen = new Map<number, number>()
  let repeated = 0
  for (const p of ev.pieces) {
    for (let i = 1; i < p.nodes.length; i++) {
      const [a, b] = p.nodes[i - 1] < p.nodes[i] ? [p.nodes[i - 1], p.nodes[i]] : [p.nodes[i], p.nodes[i - 1]]
      const k = a * g.n + b
      const c = seen.get(k) ?? 0
      if (c) repeated += dist(xy(a), xy(b))
      seen.set(k, c + 1)
    }
  }

  const errPct = Math.abs(ev.lengthM - D) / D
  const distFit = Math.max(0, Math.min(1, 1 - errPct / tol))
  return {
    lengthM: ev.lengthM,
    drawingM: ev.drawingM,
    transitM: ev.transitM,
    fidelity,
    distFit,
    errPct,
    clean: 1 - repeated / Math.max(1, ev.lengthM),
    score: Math.round(100 * (0.7 * fidelity + 0.3 * distFit)),
  }
}

/**
 * Search a square area for placements (position × rotation) of the drawing whose routed
 * length lands within tolerance, then return the best few per metric.
 * Coarse pass over a grid of positions, then a local refinement around the top scorers.
 * Scale is solved per candidate (routed length ≈ linear in scale → proportional steps).
 */
export function searchArea(g: Graph, prep: Prepared, o: SearchOpts): RouteResult[] {
  const D = o.targetM
  const t0 = Date.now()
  const budget = o.budgetMs ?? 25_000
  const out = () => Date.now() - t0 > budget
  const W0 = D / prep.unitLen / 1.8 // street inflation is typically 1.5–2.5×
  const step = Math.min(700, Math.max(350, W0 * 0.4))
  const half = o.areaM / 2
  const deg = (d: number) => (d * Math.PI) / 180
  const pool: Cand[] = []
  const seen = new Set<string>()

  /** Place at (theta, off), correcting scale until the length hits the tolerance. */
  const tryCand = (theta: number, off: XY, Wstart: number) => {
    const k = `${theta.toFixed(3)}|${Math.round(off[0])}|${Math.round(off[1])}`
    if (seen.has(k)) return
    seen.add(k)
    let W = Wstart
    for (let i = 0; i < 4; i++) {
      const ev = evaluate(g, prep, W, theta, off)
      if (!ev) return
      if (Math.abs(ev.lengthM - D) / D <= o.tol) {
        pool.push({ theta, off, W, m: measure(g, ev, W, D, o.tol) })
        return
      }
      W = Math.min(W * 3, Math.max(W / 3, (W * D) / ev.lengthM))
    }
  }

  // 1. coarse grid, nearest the center first so useful results appear early
  const positions: XY[] = []
  for (let x = -half; x <= half; x += step) for (let y = -half; y <= half; y += step) positions.push([x, y])
  positions.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  const rots = [0, deg(20), deg(-20)]
  const total = positions.length * rots.length + 240
  let done = 0
  for (const pos of positions) {
    if (out()) break
    const hasStreets = nearestK(g, [pos[0], pos[1]], 1, 4).length > 0 // skip parks, rivers, outside the map
    for (const theta of rots) {
      if (hasStreets) tryCand(theta, pos, W0)
      o.onProgress?.(++done, total)
    }
  }

  const pick = () => selectVariations(g, prep, pool, o, Math.max(400, W0 * 0.5))
  if (pool.length) o.onPartial?.(pick())

  // 2. refine around the best placements: half-step offsets and ±8° rotations
  for (const c of [...pool].sort((a, b) => b.m.score - a.m.score).slice(0, 10)) {
    if (out()) break
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4
      const off: XY = [c.off[0] + (step / 2) * Math.cos(a), c.off[1] + (step / 2) * Math.sin(a)]
      for (const d of [-8, 0, 8]) tryCand(c.theta + deg(d), off, c.W)
    }
  }
  o.onProgress?.(total, total)
  return pick()
}

/** Top few per metric (spatially spread out so they're genuinely different), rebuilt with geometry. */
function selectVariations(g: Graph, prep: Prepared, pool: Cand[], o: SearchOpts, sepM: number): RouteResult[] {
  const keys: ((c: Cand) => number)[] = [
    (c) => c.m.score,
    (c) => c.m.fidelity,
    (c) => -c.m.errPct,
    (c) => c.m.clean,
  ]
  const chosen = new Set<Cand>()
  for (const key of keys) {
    const picked: Cand[] = []
    for (const c of [...pool].sort((a, b) => key(b) - key(a) || b.m.score - a.m.score)) {
      if (picked.every((p) => dist(p.off, c.off) >= sepM)) picked.push(c)
      if (picked.length === 5) break
    }
    picked.forEach((c) => chosen.add(c))
  }
  const f = frame(o.center[0], o.center[1])
  return [...chosen]
    .sort((a, b) => b.m.score - a.m.score)
    .flatMap((c) => {
      const ev = evaluate(g, prep, c.W, c.theta, c.off)
      if (!ev) return []
      return [
        {
          ...c.m,
          segments: ev.pieces.map((p) => ({
            pts: p.nodes.map((n) => f.toLatLon([g.xy[2 * n], g.xy[2 * n + 1]])),
            transit: p.transit,
          })),
          withinTol: true,
          widthM: c.W,
          rotationDeg: Math.round((c.theta * 180) / Math.PI),
          off: c.off,
        },
      ]
    })
}
