export type XY = [number, number]
export type LatLon = [number, number]

const M_PER_DEG = 111_320

/** Local equirectangular frame (meters east/north of lat0/lon0); fine for runs < 50 km. */
export function frame(lat0: number, lon0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180)
  return {
    toXY: (lat: number, lon: number): XY => [(lon - lon0) * M_PER_DEG * k, (lat - lat0) * M_PER_DEG],
    toLatLon: (p: XY): LatLon => [lat0 + p[1] / M_PER_DEG, lon0 + p[0] / (M_PER_DEG * k)],
  }
}

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function polyLen(pts: XY[]) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i])
  return s
}

export function distToSeg(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function distToPolyline(p: XY, poly: XY[]) {
  if (poly.length === 1) return dist(p, poly[0])
  let best = Infinity
  for (let i = 1; i < poly.length; i++) best = Math.min(best, distToSeg(p, poly[i - 1], poly[i]))
  return best
}

/** Ramer–Douglas–Peucker (iterative, so long routes can't blow the stack). */
export function rdp(pts: XY[], eps: number): XY[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let k = i + 1; k < j; k++) {
      const d = distToSeg(pts[k], pts[i], pts[j])
      if (d > maxD) {
        maxD = d
        idx = k
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1
      stack.push([i, idx], [idx, j])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Evenly spaced points along a polyline, always including both endpoints. */
export function resample(pts: XY[], step: number): XY[] {
  const total = polyLen(pts)
  if (pts.length < 2 || total === 0) return [pts[0]]
  const n = Math.max(1, Math.round(total / step))
  const out: XY[] = [pts[0]]
  let seg = 1
  let acc = 0 // arclength at start of segment `seg-1`
  for (let i = 1; i < n; i++) {
    const target = (total * i) / n
    while (seg < pts.length - 1 && acc + dist(pts[seg - 1], pts[seg]) < target) {
      acc += dist(pts[seg - 1], pts[seg])
      seg++
    }
    const l = dist(pts[seg - 1], pts[seg]) || 1
    const t = (target - acc) / l
    out.push([
      pts[seg - 1][0] + t * (pts[seg][0] - pts[seg - 1][0]),
      pts[seg - 1][1] + t * (pts[seg][1] - pts[seg - 1][1]),
    ])
  }
  out.push(pts[pts.length - 1])
  return out
}
