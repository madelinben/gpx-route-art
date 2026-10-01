import { expect, test } from 'vitest'
import { downsample, buildGpx, gpxFileName } from '../export/gpx'
import { frame, rdp } from '../geo/geo'
import type { LatLon, XY } from '../geo/geo'
import { textStrokes } from '../canvas/hershey'
import { route } from './astar'
import { buildGraph } from './graph'
import type { OverpassElement } from './graph'
import { prepare } from './pipeline'
import { solve } from './solve'

const f = frame(51.5, -0.1)

/** n×n street grid, 100 m blocks, as Overpass elements. */
function grid(n: number): OverpassElement[] {
  const els: OverpassElement[] = []
  const id = (i: number, j: number) => i * n + j + 1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [lat, lon] = f.toLatLon([(i - n / 2) * 100, (j - n / 2) * 100])
      els.push({ type: 'node', id: id(i, j), lat, lon })
    }
  }
  for (let i = 0; i < n; i++) {
    els.push({ type: 'way', id: 1000 + i, nodes: Array.from({ length: n }, (_, j) => id(i, j)) })
    els.push({ type: 'way', id: 2000 + i, nodes: Array.from({ length: n }, (_, j) => id(j, i)) })
  }
  // island that must be dropped
  els.push({ type: 'node', id: 9001, lat: 51.6, lon: -0.1 }, { type: 'node', id: 9002, lat: 51.6001, lon: -0.1 })
  els.push({ type: 'way', id: 9003, nodes: [9001, 9002] })
  return els
}

test('graph keeps largest component; A* finds the Manhattan shortest path', () => {
  const g = buildGraph(grid(10), f.toXY)
  expect(g.n).toBe(100)
  const a = 0
  const b = g.n - 1
  const p = route(g, a, b, { alpha: 0, spacing: 100 })!
  const len = p.slice(1).reduce((s, n, i) => s + Math.hypot(g.xy[2 * n] - g.xy[2 * p[i]], g.xy[2 * n + 1] - g.xy[2 * p[i] + 1]), 0)
  expect(len).toBeCloseTo(1800, 0) // 9 blocks right + 9 up
})

test('solver lands a square within tolerance on a synthetic grid', () => {
  const g = buildGraph(grid(40), f.toXY)
  const square = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]]
  const prep = prepare(square)!
  const r = solve(g, prep, { targetM: 4000, tol: 0.1, center: [51.5, -0.1], budgetMs: 10_000 })!
  expect(r.withinTol).toBe(true)
  expect(Math.abs(r.lengthM - 4000) / 4000).toBeLessThanOrEqual(0.1)
  expect(r.fidelity).toBeGreaterThan(0.5)
})

test('prepare orders multi-stroke drawings and normalizes to a unit box', () => {
  const p = prepare([
    [{ x: 0, y: 0 }, { x: 0.2, y: 0 }],
    [{ x: 0.9, y: 0.9 }, { x: 1, y: 0.9 }],
    [{ x: 0.3, y: 0 }, { x: 0.5, y: 0 }],
  ])!
  expect(p.strokes).toHaveLength(3)
  expect(p.strokes[1][0][0]).toBeLessThan(p.strokes[2][0][0]) // nearest-endpoint order, not draw order
  const xs = p.strokes.flat().map((q) => q[0])
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1)
})

test('rdp drops collinear points', () => {
  const pts: XY[] = [[0, 0], [1, 0.001], [2, 0], [3, 5]]
  expect(rdp(pts, 0.1)).toHaveLength(3)
})

test('GPX: well-formed, escaped, capped, locale-safe', () => {
  const pts: LatLon[] = Array.from({ length: 3000 }, (_, i) => f.toLatLon([i, Math.sin(i / 20) * 50]))
  const out = downsample(pts, 1000)
  expect(out.length).toBeLessThanOrEqual(1000)
  expect(out[0]).toEqual(pts[0])
  const xml = buildGpx({ name: 'A & <B>', desc: 'x', pts, kind: 'trk', maxPoints: 500 })
  expect(xml).toContain('<name>A &amp; &lt;B&gt;</name>')
  expect(xml.match(/<trkpt /g)!.length).toBeLessThanOrEqual(500)
  expect(xml).toMatch(/lat="51\.\d{6}" lon="-0\.\d{6}"/)
  expect(buildGpx({ name: 'n', desc: 'd', pts: pts.slice(0, 5), kind: 'rte' })).toContain('<rtept')
  expect(gpxFileName('Hé llo!', 6.234, new Date('2026-10-01'))).toBe('gps-art_H-llo_6.2km_2026-10-01.gpx')
})

test('hershey text yields strokes inside the unit square', () => {
  const s = textStrokes('HI')
  expect(s.length).toBeGreaterThan(2)
  for (const p of s.flat()) {
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThanOrEqual(1)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeLessThanOrEqual(1)
  }
})
