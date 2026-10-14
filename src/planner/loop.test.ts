import { expect, test } from 'vitest'
import { frame } from '../geo/geo'
import { buildGraph } from '../routing/graph'
import type { OverpassElement } from '../routing/graph'
import { planLoops, toRouteResult } from './loop'

const f = frame(51.5, -0.1)

/** n×n street grid, 100 m blocks, centred on the origin. */
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
  return els
}

test('plans closed loops near the target length on a street grid', () => {
  const g = buildGraph(grid(60), f.toXY)
  const loops = planLoops(g, 5000, 0.1)
  expect(loops.length).toBeGreaterThan(0)
  const best = loops[0]
  expect(best.nodes[0]).toBe(best.nodes[best.nodes.length - 1]) // returns to the start
  expect(best.errPct).toBeLessThan(0.15)
  expect(best.clean).toBeGreaterThan(0.6)
  expect(loops.map((l) => l.score)).toEqual([...loops.map((l) => l.score)].sort((a, b) => b - a))
})

test('no streets near the pin gives no loops', () => {
  const g = buildGraph(grid(8), f.toXY) // 800 m block; pin far away from it
  const far = buildGraph(grid(8), frame(51.5, -0.1 + 0.2).toXY) // origin 14 km east of the data
  expect(planLoops(far, 3000, 0.1)).toEqual([])
  expect(g.n).toBeGreaterThan(0)
})

test('toRouteResult maps a loop into the shared result shape', () => {
  const g = buildGraph(grid(60), f.toXY)
  const [loop] = planLoops(g, 4000, 0.2)
  const r = toRouteResult(g, loop, [51.5, -0.1], 0.2)
  expect(r.segments[0].pts.length).toBe(loop.nodes.length)
  expect(r.withinTol).toBe(loop.errPct <= 0.2)
  expect(r.transitM).toBe(0)
})
