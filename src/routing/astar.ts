import type { XY } from '../geo/geo'
import { distToSeg } from '../geo/geo'
import type { Graph } from './graph'

// Minimal binary min-heap of [priority, node].
class Heap {
  private p: number[] = []
  private v: number[] = []
  get size() {
    return this.v.length
  }
  push(pri: number, val: number) {
    let i = this.v.length
    this.p.push(pri)
    this.v.push(val)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (this.p[up] <= pri) break
      this.p[i] = this.p[up]
      this.v[i] = this.v[up]
      i = up
    }
    this.p[i] = pri
    this.v[i] = val
  }
  pop(): number {
    const top = this.v[0]
    const pri = this.p.pop()!
    const val = this.v.pop()!
    const n = this.v.length
    if (n) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && this.p[c + 1] < this.p[c]) c++
        if (this.p[c] >= pri) break
        this.p[i] = this.p[c]
        this.v[i] = this.v[c]
        i = c
      }
      this.p[i] = pri
      this.v[i] = val
    }
    return top
  }
}

export type RouteOpts = {
  /** Target segment the route should hug (shape-aware cost). */
  seg?: [XY, XY]
  /** 0 = plain shortest path (transit). */
  alpha: number
  spacing: number
  /** Max distance a node may stray from `seg`; unbounded when absent. */
  buffer?: number
}

/**
 * A* with cost = length × (1 + α·deviation/spacing). Cost ≥ length ≥ euclid,
 * so the euclidean heuristic stays admissible.
 */
export function route(g: Graph, from: number, to: number, o: RouteOpts): number[] | null {
  if (from === to) return [from]
  const gen = ++g.gen
  const tx = g.xy[2 * to]
  const ty = g.xy[2 * to + 1]
  const h = (n: number) => Math.hypot(g.xy[2 * n] - tx, g.xy[2 * n + 1] - ty)
  const heap = new Heap()
  g.stamp[from] = gen
  g.gScore[from] = 0
  g.prev[from] = -1
  heap.push(h(from), from)
  const closed = new Set<number>()
  while (heap.size) {
    const u = heap.pop()
    if (u === to) {
      const path = [u]
      while (g.prev[path[path.length - 1]] !== -1) path.push(g.prev[path[path.length - 1]])
      return path.reverse()
    }
    if (closed.has(u)) continue
    closed.add(u)
    const ux = g.xy[2 * u]
    const uy = g.xy[2 * u + 1]
    for (const { to: v, w } of g.adj[u]) {
      const vx = g.xy[2 * v]
      const vy = g.xy[2 * v + 1]
      let cost = w
      if (o.seg) {
        if (o.buffer !== undefined && distToSeg([vx, vy], o.seg[0], o.seg[1]) > o.buffer) continue
        if (o.alpha > 0) {
          const dev = distToSeg([(ux + vx) / 2, (uy + vy) / 2], o.seg[0], o.seg[1])
          cost = w * (1 + (o.alpha * dev) / o.spacing)
        }
      }
      const ng = g.gScore[u] + cost
      if (g.stamp[v] !== gen || ng < g.gScore[v]) {
        g.stamp[v] = gen
        g.gScore[v] = ng
        g.prev[v] = u
        heap.push(ng + h(v), v)
      }
    }
  }
  return null
}

export type Target = { n: number; pen: number }

/**
 * Cheapest route from `from` to any of `targets` (cost + that target's penalty).
 * Dijkstra with early exit; lets each anchor choose among a few nearby nodes instead
 * of being forced onto the single nearest one (which may sit across a barrier).
 */
export function routeToAny(g: Graph, from: number, targets: Target[], o: RouteOpts): number[] | null {
  const pen = new Map(targets.map((t) => [t.n, t.pen]))
  const gen = ++g.gen
  const heap = new Heap()
  g.stamp[from] = gen
  g.gScore[from] = 0
  g.prev[from] = -1
  heap.push(0, from)
  const closed = new Set<number>()
  let best = Infinity
  let bestNode = -1
  while (heap.size) {
    const u = heap.pop()
    if (closed.has(u)) continue
    if (g.gScore[u] >= best) break
    closed.add(u)
    const p = pen.get(u)
    if (p !== undefined && g.gScore[u] + p < best) {
      best = g.gScore[u] + p
      bestNode = u
    }
    const ux = g.xy[2 * u]
    const uy = g.xy[2 * u + 1]
    for (const { to: v, w } of g.adj[u]) {
      const vx = g.xy[2 * v]
      const vy = g.xy[2 * v + 1]
      let cost = w
      if (o.seg) {
        if (o.buffer !== undefined && distToSeg([vx, vy], o.seg[0], o.seg[1]) > o.buffer) continue
        if (o.alpha > 0) {
          const dev = distToSeg([(ux + vx) / 2, (uy + vy) / 2], o.seg[0], o.seg[1])
          cost = w * (1 + (o.alpha * dev) / o.spacing)
        }
      }
      const ng = g.gScore[u] + cost
      if (g.stamp[v] !== gen || ng < g.gScore[v]) {
        g.stamp[v] = gen
        g.gScore[v] = ng
        g.prev[v] = u
        heap.push(ng, v)
      }
    }
  }
  if (bestNode < 0) return null
  const path = [bestNode]
  while (g.prev[path[path.length - 1]] !== -1) path.push(g.prev[path[path.length - 1]])
  return path.reverse()
}
