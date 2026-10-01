import type { XY } from '../geo/geo'
import { dist } from '../geo/geo'

export type OverpassElement =
  | { type: 'node'; id: number; lat: number; lon: number }
  | { type: 'way'; id: number; nodes: number[] }

export type Graph = {
  n: number
  xy: Float64Array // [x0, y0, x1, y1, ...] meters
  adj: { to: number; w: number }[][]
  cell: number
  grid: Map<number, number[]>
  // scratch buffers reused across searches
  gScore: Float64Array
  prev: Int32Array
  stamp: Int32Array
  gen: number
}

const CELL = 100
const key = (cx: number, cy: number) => cx * 100_003 + cy

/** Build a walkable graph from Overpass JSON, keeping only the largest connected component. */
export function buildGraph(elements: OverpassElement[], toXY: (lat: number, lon: number) => XY): Graph {
  const pos = new Map<number, XY>()
  for (const e of elements) if (e.type === 'node') pos.set(e.id, toXY(e.lat, e.lon))

  const idx = new Map<number, number>()
  const pts: XY[] = []
  const edges: [number, number][] = []
  const id = (osm: number) => {
    let i = idx.get(osm)
    if (i === undefined) {
      i = pts.length
      idx.set(osm, i)
      pts.push(pos.get(osm)!)
    }
    return i
  }
  for (const e of elements) {
    if (e.type !== 'way') continue
    for (let k = 1; k < e.nodes.length; k++) {
      if (pos.has(e.nodes[k - 1]) && pos.has(e.nodes[k])) edges.push([id(e.nodes[k - 1]), id(e.nodes[k])])
    }
  }

  // largest connected component via union-find
  const parent = Int32Array.from({ length: pts.length }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (const [a, b] of edges) parent[find(a)] = find(b)
  const size = new Map<number, number>()
  for (let i = 0; i < pts.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1)
  let root = -1
  let best = 0
  for (const [r, s] of size) if (s > best) ((best = s), (root = r))

  const remap = new Int32Array(pts.length).fill(-1)
  let n = 0
  for (let i = 0; i < pts.length; i++) if (find(i) === root) remap[i] = n++

  const xy = new Float64Array(n * 2)
  const adj: Graph['adj'] = Array.from({ length: n }, () => [])
  const grid = new Map<number, number[]>()
  for (let i = 0; i < pts.length; i++) {
    const j = remap[i]
    if (j < 0) continue
    xy[2 * j] = pts[i][0]
    xy[2 * j + 1] = pts[i][1]
    const k = key(Math.floor(pts[i][0] / CELL), Math.floor(pts[i][1] / CELL))
    const bucket = grid.get(k)
    if (bucket) bucket.push(j)
    else grid.set(k, [j])
  }
  for (const [a, b] of edges) {
    const ja = remap[a]
    const jb = remap[b]
    if (ja < 0 || jb < 0 || ja === jb) continue
    const w = dist([xy[2 * ja], xy[2 * ja + 1]], [xy[2 * jb], xy[2 * jb + 1]])
    adj[ja].push({ to: jb, w })
    adj[jb].push({ to: ja, w })
  }
  return {
    n,
    xy,
    adj,
    cell: CELL,
    grid,
    gScore: new Float64Array(n),
    prev: new Int32Array(n),
    stamp: new Int32Array(n),
    gen: 0,
  }
}

/** The k nearest graph nodes to p (grid-ring search); empty if nothing within ~5 km. */
export function nearestK(g: Graph, p: XY, k = 1, maxRings = 50): { n: number; d: number }[] {
  const cx = Math.floor(p[0] / g.cell)
  const cy = Math.floor(p[1] / g.cell)
  let found: { n: number; d: number }[] = []
  for (let r = 0; r <= maxRings; r++) {
    if (found.length >= k && (r - 1) * g.cell > found[k - 1].d) break
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue
        for (const n of g.grid.get(key(x, y)) ?? []) {
          found.push({ n, d: Math.hypot(g.xy[2 * n] - p[0], g.xy[2 * n + 1] - p[1]) })
        }
      }
    }
    found.sort((a, b) => a.d - b.d)
    found = found.slice(0, k)
  }
  return found
}

export const nearest = (g: Graph, p: XY, maxRings = 50) => nearestK(g, p, 1, maxRings)[0]?.n ?? -1
