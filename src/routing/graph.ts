import type { XY } from '../geo/geo'

export type OverpassElement =
  | { type: 'node'; id: number; lat: number; lon: number }
  | { type: 'way'; id: number; nodes: number[] }

/** Compact (typed-array) form of one Overpass response: cheap to cache and to merge. */
export type Tile = {
  nid: Float64Array
  lat: Float64Array
  lon: Float64Array
  wayId: Float64Array
  wayEnd: Int32Array // exclusive end offset of each way inside wayNodes
  wayNodes: Float64Array // OSM node ids
}

export function compactElements(els: OverpassElement[]): Tile {
  let nn = 0
  let nw = 0
  let nr = 0
  for (const e of els) {
    if (e.type === 'node') nn++
    else (nw++, (nr += e.nodes.length))
  }
  const t: Tile = {
    nid: new Float64Array(nn),
    lat: new Float64Array(nn),
    lon: new Float64Array(nn),
    wayId: new Float64Array(nw),
    wayEnd: new Int32Array(nw),
    wayNodes: new Float64Array(nr),
  }
  let i = 0
  let w = 0
  let r = 0
  for (const e of els) {
    if (e.type === 'node') {
      t.nid[i] = e.id
      t.lat[i] = e.lat
      t.lon[i++] = e.lon
    } else {
      t.wayId[w] = e.id
      for (const n of e.nodes) t.wayNodes[r++] = n
      t.wayEnd[w++] = r
    }
  }
  return t
}

export type Graph = {
  n: number
  xy: Float64Array // [x0, y0, x1, y1, ...] meters
  // CSR adjacency: edges of node u are off[u]..off[u+1]
  off: Int32Array
  to: Int32Array
  w: Float32Array
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

/** Merge tiles into one walkable graph, keeping only the largest connected component. */
export function buildGraphFromTiles(tiles: Tile[], toXY: (lat: number, lon: number) => XY): Graph {
  const idx = new Map<number, number>()
  const px: number[] = []
  const py: number[] = []
  for (const t of tiles) {
    for (let i = 0; i < t.nid.length; i++) {
      if (idx.has(t.nid[i])) continue
      const [x, y] = toXY(t.lat[i], t.lon[i])
      idx.set(t.nid[i], px.length)
      px.push(x)
      py.push(y)
    }
  }

  const ea: number[] = []
  const eb: number[] = []
  const ways = new Set<number>() // a way crossing a tile edge appears in both tiles
  for (const t of tiles) {
    let start = 0
    for (let w = 0; w < t.wayId.length; w++) {
      const end = t.wayEnd[w]
      if (!ways.has(t.wayId[w])) {
        ways.add(t.wayId[w])
        for (let k = start + 1; k < end; k++) {
          const a = idx.get(t.wayNodes[k - 1])
          const b = idx.get(t.wayNodes[k])
          if (a !== undefined && b !== undefined && a !== b) (ea.push(a), eb.push(b))
        }
      }
      start = end
    }
  }

  // largest connected component via union-find
  const n0 = px.length
  const parent = Int32Array.from({ length: n0 }, (_, i) => i)
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let e = 0; e < ea.length; e++) parent[find(ea[e])] = find(eb[e])
  const size = new Int32Array(n0)
  for (let i = 0; i < n0; i++) size[find(i)]++
  let root = -1
  for (let i = 0; i < n0; i++) if (size[i] > (root < 0 ? 0 : size[root])) root = i

  const remap = new Int32Array(n0).fill(-1)
  let n = 0
  for (let i = 0; i < n0; i++) if (find(i) === root) remap[i] = n++

  const xy = new Float64Array(n * 2)
  const grid = new Map<number, number[]>()
  for (let i = 0; i < n0; i++) {
    const j = remap[i]
    if (j < 0) continue
    xy[2 * j] = px[i]
    xy[2 * j + 1] = py[i]
    const k = key(Math.floor(px[i] / CELL), Math.floor(py[i] / CELL))
    const bucket = grid.get(k)
    if (bucket) bucket.push(j)
    else grid.set(k, [j])
  }

  const deg = new Int32Array(n + 1)
  for (let e = 0; e < ea.length; e++) {
    if (remap[ea[e]] >= 0 && remap[eb[e]] >= 0) (deg[remap[ea[e]]]++, deg[remap[eb[e]]]++)
  }
  const off = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i]
  const fill = off.slice(0, n)
  const to = new Int32Array(off[n])
  const w = new Float32Array(off[n])
  for (let e = 0; e < ea.length; e++) {
    const a = remap[ea[e]]
    const b = remap[eb[e]]
    if (a < 0 || b < 0) continue
    const len = Math.hypot(xy[2 * a] - xy[2 * b], xy[2 * a + 1] - xy[2 * b + 1])
    to[fill[a]] = b
    w[fill[a]++] = len
    to[fill[b]] = a
    w[fill[b]++] = len
  }

  return {
    n,
    xy,
    off,
    to,
    w,
    cell: CELL,
    grid,
    gScore: new Float64Array(n),
    prev: new Int32Array(n),
    stamp: new Int32Array(n),
    gen: 0,
  }
}

export const buildGraph = (els: OverpassElement[], toXY: (lat: number, lon: number) => XY) =>
  buildGraphFromTiles([compactElements(els)], toXY)

/** The k nearest graph nodes to p (grid-ring search); empty if none within `maxRings` cells. */
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
