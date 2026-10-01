import { expect, test } from 'vitest'
import { toNorm, toPx } from './drawing'

test('norm/px round-trip survives rotation-style resize', () => {
  const p = toNorm(150, 120, 300, 200)
  expect(p.x).toBeCloseTo(0.5 + (150 - 150) / 200)
  for (const [w, h] of [[300, 200], [200, 300], [320, 568]]) {
    const q = toPx(p, w, h)
    const back = toNorm(q.x, q.y, w, h)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  }
})

test('clamps outside the square', () => {
  expect(toNorm(-50, 999, 300, 200)).toEqual({ x: 0, y: 1 })
})
