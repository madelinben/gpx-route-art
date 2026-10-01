import type { Stroke } from './drawing'

type P = [number, number]

/** Scale polylines together to fit the 0.1–0.9 box, aspect preserved and centered. */
function fit(lines: P[][]): Stroke[] {
  const all = lines.flat()
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const ext = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1
  const s = 0.8 / ext
  const ox = 0.5 - ((Math.max(...xs) - minX) * s) / 2
  const oy = 0.5 - ((Math.max(...ys) - minY) * s) / 2
  return lines.map((l) => l.map(([x, y]) => ({ x: ox + (x - minX) * s, y: oy + (y - minY) * s })))
}

const ring = (n: number, f: (t: number) => P, turn = 2 * Math.PI): P[] =>
  Array.from({ length: n + 1 }, (_, i) => f((i / n) * turn))

/** Closed Catmull-Rom spline through the control points (rounds off hand-placed outlines). */
function smooth(pts: P[], per = 8): P[] {
  const n = pts.length - 1 // last point repeats the first
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]]
    for (let k = 0; k < per; k++) {
      const t = k / per
      const c = (a: number, b: number, c2: number, d: number) =>
        0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t * t + (-a + 3 * b - 3 * c2 + d) * t ** 3)
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(out[0])
  return out
}

// Closed single strokes route best (no transit gaps); multi-stroke shapes are fine too.
export const STAMPS: { id: string; label: string; emoji: string; strokes: () => Stroke[] }[] = [
  {
    id: 'heart',
    label: 'Heart',
    emoji: '❤️',
    strokes: () =>
      fit([
        ring(60, (t) => [
          16 * Math.sin(t) ** 3,
          -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
        ]),
      ]),
  },
  {
    id: 'star',
    label: 'Star',
    emoji: '⭐',
    // pentagram: connect every second vertex
    strokes: () =>
      fit([
        [0, 2, 4, 1, 3, 0].map((i): P => [Math.sin((i * 2 * Math.PI) / 5), -Math.cos((i * 2 * Math.PI) / 5)]),
      ]),
  },
  {
    id: 'flower',
    label: 'Flower',
    emoji: '🌸',
    // five-petal rose curve r = cos(5θ), one petal pointing up: one closed stroke through the middle
    strokes: () => fit([ring(120, (t) => [Math.cos(5 * t) * Math.sin(t), -Math.cos(5 * t) * Math.cos(t)], Math.PI)]),
  },
  {
    id: 'flame',
    label: 'Flame',
    emoji: '🔥',
    strokes: () =>
      fit([
        smooth([
          [0.5, 1],
          [0.22, 0.88],
          [0.08, 0.65],
          [0.14, 0.42],
          [0.3, 0.28],
          [0.36, 0.42],
          [0.42, 0.18],
          [0.55, 0],
          [0.62, 0.2],
          [0.72, 0.36],
          [0.9, 0.55],
          [0.92, 0.75],
          [0.78, 0.92],
          [0.5, 1],
        ]),
      ]),
  },
  {
    id: 'stickman',
    label: 'Stick man',
    emoji: '🚶',
    strokes: () =>
      fit([
        [[0.25, 1], [0.5, 0.62], [0.75, 1]], // legs
        [[0.5, 0.62], [0.5, 0.3], ...ring(24, (t) => [0.5 + 0.13 * Math.sin(t), 0.17 + 0.13 * Math.cos(t)])], // body, then head
        [[0.15, 0.42], [0.85, 0.42]], // arms
      ]),
  },
  { id: 'circle', label: 'Circle', emoji: '⚪', strokes: () => fit([ring(48, (t) => [Math.cos(t), Math.sin(t)])]) },
  { id: 'square', label: 'Square', emoji: '⬜', strokes: () => fit([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) },
  { id: 'triangle', label: 'Triangle', emoji: '🔺', strokes: () => fit([[[0.5, 0], [1, 0.87], [0, 0.87], [0.5, 0]]]) },
  { id: 'bolt', label: 'Bolt', emoji: '⚡', strokes: () => fit([[[0.6, 0], [0.1, 0.55], [0.5, 0.55], [0.35, 1], [0.95, 0.4], [0.55, 0.4], [0.6, 0]]]) },
  { id: 'house', label: 'House', emoji: '🏠', strokes: () => fit([[[0, 0.5], [0.5, 0], [1, 0.5], [1, 1], [0, 1], [0, 0.5]]]) },
  {
    id: 'tree',
    label: 'Tree',
    emoji: '🌲',
    strokes: () =>
      fit([
        [[0.42, 1], [0.42, 0.82], [0.15, 0.82], [0.33, 0.6], [0.22, 0.6], [0.38, 0.38], [0.3, 0.38], [0.5, 0.05],
         [0.7, 0.38], [0.62, 0.38], [0.78, 0.6], [0.67, 0.6], [0.85, 0.82], [0.58, 0.82], [0.58, 1], [0.42, 1]],
      ]),
  },
  {
    id: 'fish',
    label: 'Fish',
    emoji: '🐟',
    strokes: () =>
      fit([[[0, 0.5], [0.2, 0.25], [0.45, 0.2], [0.7, 0.4], [1, 0.2], [0.88, 0.5], [1, 0.8], [0.7, 0.6], [0.45, 0.8], [0.2, 0.75], [0, 0.5]]]),
  },
]
