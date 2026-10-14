import { frame } from '../geo/geo'
import type { LatLon, XY } from '../geo/geo'
import { routeToAny } from '../routing/astar'
import { nearestK } from '../routing/graph'
import type { Graph } from '../routing/graph'
import type { RouteResult } from '../routing/solve'

const ROTATIONS = 8 // loop headings tried, 45° apart
const FIT_ROUNDS = 3 // radius re-scaling passes
const WAYPOINTS = 3 // points on the circle besides the start
const STREET_FACTOR = 1.2 // routed length ≈ 1.2 × straight circle perimeter
const MAX_START_GAP_M = 500

export type Loop = {
  nodes: number[]
  lengthM: number
  /** |length − target| / target */
  errPct: number
  /** 0–1: share of the loop that never doubles back over the same street. */
  clean: number
  score: number
  rotationDeg: number
}

const pathLen = (g: Graph, nodes: number[]) =>
  nodes.slice(1).reduce((s, n, i) => s + Math.hypot(g.xy[2 * n] - g.xy[2 * nodes[i]], g.xy[2 * n + 1] - g.xy[2 * nodes[i] + 1]), 0)

/** Route start → waypoints → start along streets; null if any leg is unreachable. */
function route(g: Graph, startNode: number, via: XY[]): number[] | null {
  const stops = [...via.map((p) => nearestK(g, p, 3).map(({ n, d }) => ({ n, pen: d }))), [{ n: startNode, pen: 0 }]]
  const nodes = [startNode]
  for (const targets of stops) {
    if (!targets.length) return null
    const leg = routeToAny(g, nodes[nodes.length - 1], targets, { alpha: 0, spacing: 100 })
    if (!leg) return null
    nodes.push(...leg.slice(1))
  }
  return nodes
}

/** Share of path length on streets used only once (1 = no doubling back). */
function cleanliness(g: Graph, nodes: number[]): number {
  const seen = new Set<number>()
  let unique = 0
  for (let i = 1; i < nodes.length; i++) {
    const [a, b] = nodes[i - 1] < nodes[i] ? [nodes[i - 1], nodes[i]] : [nodes[i], nodes[i - 1]]
    const k = a * g.n + b
    if (seen.has(k)) continue
    seen.add(k)
    unique += Math.hypot(g.xy[2 * a] - g.xy[2 * b], g.xy[2 * a + 1] - g.xy[2 * b + 1])
  }
  const total = pathLen(g, nodes)
  return total ? Math.min(1, unique / total) : 1
}

/** Loops from the graph origin (the start pin) with length near `targetM`, best first. */
export function planLoops(g: Graph, targetM: number, tol: number): Loop[] {
  const start = nearestK(g, [0, 0], 1)[0]
  if (!start || start.d > MAX_START_GAP_M) return []

  const loops: Loop[] = []
  for (let k = 0; k < ROTATIONS; k++) {
    const phi = (k * 2 * Math.PI) / ROTATIONS
    let r = targetM / (2 * Math.PI) / STREET_FACTOR
    let nodes: number[] | null = null
    for (let round = 0; round < FIT_ROUNDS; round++) {
      // circle through the start: centre sits r away along heading phi
      const c: XY = [r * Math.cos(phi), r * Math.sin(phi)]
      const via = Array.from({ length: WAYPOINTS }, (_, i): XY => {
        const a = phi + Math.PI + ((i + 1) * 2 * Math.PI) / (WAYPOINTS + 1)
        return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
      })
      nodes = route(g, start.n, via)
      if (!nodes) break
      const len = pathLen(g, nodes)
      if (!len) break
      r *= targetM / len
    }
    if (!nodes) continue
    const lengthM = pathLen(g, nodes)
    const errPct = Math.abs(lengthM - targetM) / targetM
    const clean = cleanliness(g, nodes)
    const distFit = Math.max(0, 1 - errPct / (2 * Math.max(tol, 0.01)))
    loops.push({
      nodes,
      lengthM,
      errPct,
      clean,
      score: Math.round(100 * (0.6 * distFit + 0.4 * clean)),
      rotationDeg: Math.round((phi * 180) / Math.PI),
    })
  }
  return loops.sort((a, b) => b.score - a.score)
}

/** Adapt a loop to the art tool's RouteResult so MapView, Variations and GPX export are reused. */
export function toRouteResult(g: Graph, loop: Loop, center: LatLon, tol: number): RouteResult {
  const f = frame(center[0], center[1])
  const pts = loop.nodes.map((n): LatLon => f.toLatLon([g.xy[2 * n], g.xy[2 * n + 1]]))
  return {
    lengthM: loop.lengthM,
    drawingM: loop.lengthM,
    transitM: 0,
    fidelity: 1,
    distFit: Math.max(0, 1 - loop.errPct),
    errPct: loop.errPct,
    clean: loop.clean,
    score: loop.score,
    segments: [{ pts, transit: false }],
    withinTol: loop.errPct <= tol,
    widthM: loop.lengthM / Math.PI,
    rotationDeg: loop.rotationDeg,
    off: [0, 0],
  }
}
