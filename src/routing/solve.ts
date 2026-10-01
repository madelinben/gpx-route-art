import type { LatLon, XY } from '../geo/geo'
import { dist, distToPolyline, frame, resample } from '../geo/geo'
import type { Eval, Prepared } from './pipeline'
import { evaluate } from './pipeline'
import type { Graph } from './graph'

export type RouteResult = {
  segments: { pts: LatLon[]; transit: boolean }[]
  lengthM: number
  drawingM: number
  transitM: number
  fidelity: number // 0–1
  distFit: number // 0–1
  score: number // 0–100
  withinTol: boolean
  widthM: number
  rotationDeg: number
}

export type SolveOpts = {
  targetM: number
  tol: number // e.g. 0.1
  center: LatLon
  /** Called with each new best candidate. */
  onBest?: (r: RouteResult) => void
  onProgress?: (done: number, total: number) => void
  /** Wall-clock budget for the fit search. */
  budgetMs?: number
}

const routeXY = (g: Graph, ev: Eval): XY[] =>
  ev.pieces.flatMap((p) => p.nodes.map((n): XY => [g.xy[2 * n], g.xy[2 * n + 1]]))

function meanDev(a: XY[], b: XY[], step: number) {
  const s = resample(a, step)
  return s.reduce((t, p) => t + distToPolyline(p, b), 0) / s.length
}

/** Discrete Fréchet distance between two polylines (both resampled to ≤ n points). */
function frechet(a: XY[], b: XY[], n = 80) {
  const p = resample(a, Math.max(1, polylineLen(a) / n))
  const q = resample(b, Math.max(1, polylineLen(b) / n))
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
const polylineLen = (pts: XY[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0)

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function toResult(g: Graph, ev: Eval, W: number, theta: number, o: SolveOpts): RouteResult {
  const f = frame(o.center[0], o.center[1])
  const route = routeXY(g, ev)
  const dev = (meanDev(route, ev.target, 25) + meanDev(ev.target, route, 25)) / 2
  const fr = frechet(route, ev.target)
  const fidelity = 0.5 * Math.exp(-dev / (0.08 * W)) + 0.5 * Math.exp(-fr / (0.2 * W))
  const err = Math.abs(ev.lengthM - o.targetM) / o.targetM
  const distFit = clamp01(1 - err / o.tol)
  return {
    segments: ev.pieces.map((p) => ({
      pts: p.nodes.map((n) => f.toLatLon([g.xy[2 * n], g.xy[2 * n + 1]])),
      transit: p.transit,
    })),
    lengthM: ev.lengthM,
    drawingM: ev.drawingM,
    transitM: ev.transitM,
    fidelity,
    distFit,
    score: Math.round(100 * (0.7 * fidelity + 0.3 * distFit)),
    withinTol: err <= o.tol,
    widthM: W,
    rotationDeg: Math.round((theta * 180) / Math.PI),
  }
}

/**
 * Distance-constrained fit search. Scale is solved per candidate (length ≈ linear in
 * scale → proportional steps), then rotation/offset candidates compete on score.
 * 13 rotations (±30°, 5° steps) × 25 offsets; each evaluation is ~1 ms, so the whole
 * search is a second or two. Shape fidelity (not distance) breaks ties between candidates
 * that all hit the target length.
 */
export function solve(g: Graph, prep: Prepared, o: SolveOpts): RouteResult | null {
  const D = o.targetM
  const t0 = Date.now()
  const budget = o.budgetMs ?? 25_000
  const step = (W: number, L: number) => Math.min(W * 3, Math.max(W / 3, (W * D) / L))

  // 1. global scale at identity placement; street inflation is measured, not assumed
  let W = prep.unitLen > 0 ? D / prep.unitLen / 1.3 : 500
  let base: Eval | null = null
  for (let i = 0; i < 5; i++) {
    base = evaluate(g, prep, W, 0, [0, 0])
    if (!base) {
      W *= 0.7 // likely off the map edge: shrink and retry
      continue
    }
    if (Math.abs(base.lengthM - D) / D <= o.tol / 2) break
    W = step(W, base.lengthM)
  }
  if (!base) return null

  // 2. rotation × offset candidates, each re-solving scale
  const B = Math.max(60, W * 0.08) // ≈ a block or a few % of the drawing
  const steps = [0, 1, -1, 2, -2]
  const offs = steps.flatMap((i) => steps.map((j): XY => [i * B, j * B]))
  const rots = [0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25, 30, -30]
  const cands = rots.flatMap((r) => offs.map((off) => ({ theta: (r * Math.PI) / 180, off })))
  let best: RouteResult | null = null
  let bestOut: RouteResult | null = null // closest miss, if nothing lands in tolerance
  let done = 0
  for (const c of cands) {
    if (Date.now() - t0 > budget && (best || bestOut)) break
    let w = W
    let ev = evaluate(g, prep, w, c.theta, c.off)
    for (let i = 0; ev && i < 2 && Math.abs(ev.lengthM - D) / D > o.tol; i++) {
      w = step(w, ev.lengthM)
      ev = evaluate(g, prep, w, c.theta, c.off)
    }
    done++
    o.onProgress?.(done, cands.length)
    if (!ev) continue
    const r = toResult(g, ev, w, c.theta, o)
    if (r.withinTol) {
      if (!best || r.score > best.score) {
        best = r
        o.onBest?.(r)
      }
    } else if (!bestOut || Math.abs(r.lengthM - D) < Math.abs(bestOut.lengthM - D)) {
      bestOut = r
    }
  }
  const out = best ?? bestOut
  if (out && out !== best) o.onBest?.(out)
  return out
}
