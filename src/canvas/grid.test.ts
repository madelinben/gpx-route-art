import { expect, test } from 'vitest'
import { fmtDist, gridSpec } from './grid'
import { STAMPS } from './shapes'
import { prepare } from '../routing/pipeline'

test('grid picks 100 m dots and 1 km rings for a typical run', () => {
  const g = gridSpec(1200, 320) // ~1.2 km across a 320 px square
  expect(g.minorM).toBe(100)
  expect(g.majorM).toBe(1000)
  expect(g.minorPx).toBeCloseTo(26.7, 0)
  expect(gridSpec(30_000, 320).minorM).toBeGreaterThanOrEqual(1000) // zoomed way out → coarser dots
  expect(fmtDist(100)).toBe('100 m')
  expect(fmtDist(2500)).toBe('2.5 km')
})

test('every stamp is routable and inside the square', () => {
  for (const s of STAMPS) {
    const strokes = s.strokes()
    expect(strokes.length).toBeGreaterThan(0)
    for (const p of strokes.flat()) {
      expect(p.x).toBeGreaterThanOrEqual(0.09)
      expect(p.x).toBeLessThanOrEqual(0.91)
      expect(p.y).toBeGreaterThanOrEqual(0.09)
      expect(p.y).toBeLessThanOrEqual(0.91)
    }
    expect(prepare(strokes)).not.toBeNull()
  }
})
