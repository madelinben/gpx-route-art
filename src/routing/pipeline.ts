import type { XY } from '../geo/geo'
import { dist, polyLen, rdp, resample } from '../geo/geo'
import { routeToAny } from './astar'
import type { Graph } from './graph'
import { nearestK } from './graph'

export type Prepared = {
  /** Ordered strokes, centered on 0, longest bbox side = 1, north-up. */
  strokes: XY[][]
  /** Total unit-space length: strokes + straight gaps between them. */
  unitLen: number
  /** Simplified vertex count — proxy for drawing detail. */
  vertices: number
}

/** Simplify (RDP), order strokes into one continuous line, normalize to a unit box. */
export function prepare(raw: { x: number; y: number }[][]): Prepared | null {
  let strokes: XY[][] = raw.map((s) => s.map((p): XY => [p.x, -p.y])).filter((s) => polyLen(s) > 1e-6)
  if (!strokes.length) return null

  const all = strokes.flat()
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  strokes = strokes.map((s) => rdp(s, 0.015 * diag))

  // Greedy nearest-endpoint ordering; each stroke may be reversed.
  // ponytail: no 2-opt pass; add if multi-stroke transit gaps look wasteful.
  const left = strokes.slice(1)
  const ordered: XY[][] = [strokes[0]]
  while (left.length) {
    const end = ordered[ordered.length - 1].at(-1)!
    let bi = 0
    let bd = Infinity
    let rev = false
    for (let i = 0; i < left.length; i++) {
      const a = dist(end, left[i][0])
      const b = dist(end, left[i].at(-1)!)
      if (a < bd) ((bd = a), (bi = i), (rev = false))
      if (b < bd) ((bd = b), (bi = i), (rev = true))
    }
    const [s] = left.splice(bi, 1)
    ordered.push(rev ? s.slice().reverse() : s)
  }

  const flat = ordered.flat()
  const minX = Math.min(...flat.map((p) => p[0]))
  const maxX = Math.max(...flat.map((p) => p[0]))
  const minY = Math.min(...flat.map((p) => p[1]))
  const maxY = Math.max(...flat.map((p) => p[1]))
  const ext = Math.max(maxX - minX, maxY - minY) || 1
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const unit = ordered.map((s) => s.map((p): XY => [(p[0] - cx) / ext, (p[1] - cy) / ext]))
  return {
    strokes: unit,
    unitLen: polyLen(unit.flat()),
    vertices: unit.reduce((n, s) => n + s.length, 0),
  }
}

/** Scale to width W meters, rotate by theta (rad), shift by off meters. */
export function place(strokes: XY[][], W: number, theta: number, off: XY): XY[][] {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return strokes.map((st) =>
    st.map((p): XY => {
      const x = p[0] * W
      const y = p[1] * W
      return [x * c - y * s + off[0], x * s + y * c + off[1]]
    }),
  )
}

export type Piece = { nodes: number[]; transit: boolean }
export type Eval = {
  pieces: Piece[]
  lengthM: number
  drawingM: number
  transitM: number
  target: XY[]
}

const ALPHA = 3 // shape-cost weight (brief §4.8: 2–5)
const SPACING = { min: 60, max: 120, perStroke: 150 } // anchor spacing in meters
const BUFFER = 3 // search corridor, in anchor spacings

function nodeLen(g: Graph, nodes: number[]) {
  let s = 0
  for (let i = 1; i < nodes.length; i++) {
    s += Math.hypot(
      g.xy[2 * nodes[i]] - g.xy[2 * nodes[i - 1]],
      g.xy[2 * nodes[i] + 1] - g.xy[2 * nodes[i - 1] + 1],
    )
  }
  return s
}

/** Drop out-and-back spurs (A,B,A → A) that appear where one leg ends in a dead end. */
function eraseSpurs(nodes: number[]) {
  const out: number[] = []
  for (const n of nodes) {
    if (out.length >= 2 && out[out.length - 2] === n) out.pop()
    else out.push(n)
  }
  return out
}

const K = 4 // candidate nodes per anchor
const SNAP_PEN = 2 // cost per meter an end node sits from its anchor

/**
 * Walk each stroke anchor-to-anchor. Every leg starts where the last one ended and
 * picks the cheapest of the K nearest nodes to the next anchor. Null when the drawing
 * falls off the map.
 */
export function evaluate(g: Graph, prep: Prepared, W: number, theta: number, off: XY): Eval | null {
  const placed = place(prep.strokes, W, theta, off)
  const spacing = Math.min(SPACING.max, Math.max(SPACING.min, (polyLen(prep.strokes.flat()) * W) / SPACING.perStroke))
  const pieces: Piece[] = []
  const cands = (a: XY) => nearestK(g, a, K).map(({ n, d }) => ({ n, pen: d * SNAP_PEN }))
  let cur = -1

  for (const stroke of placed) {
    const anchors = resample(stroke, spacing)
    const first = cands(anchors[0])
    if (!first.length) return null
    if (cur >= 0) {
      const t = routeToAny(g, cur, first, { alpha: 0, spacing })
      if (!t) return null
      if (t.length > 1) pieces.push({ nodes: t, transit: true })
      cur = t.at(-1)!
    } else cur = first[0].n
    const nodes: number[] = [cur]
    for (let i = 1; i < anchors.length; i++) {
      const next = cands(anchors[i])
      if (!next.length) return null
      const seg: [XY, XY] = [anchors[i - 1], anchors[i]]
      const p =
        routeToAny(g, cur, next, { seg, alpha: ALPHA, spacing, buffer: spacing * BUFFER }) ??
        routeToAny(g, cur, next, { alpha: 0, spacing })
      if (!p) return null
      nodes.push(...p.slice(1))
      cur = p.at(-1)!
    }
    pieces.push({ nodes: eraseSpurs(nodes), transit: false })
  }

  const drawingM = pieces.filter((p) => !p.transit).reduce((s, p) => s + nodeLen(g, p.nodes), 0)
  const transitM = pieces.filter((p) => p.transit).reduce((s, p) => s + nodeLen(g, p.nodes), 0)
  return { pieces, lengthM: drawingM + transitM, drawingM, transitM, target: placed.flat() }
}
