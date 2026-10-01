import type { Stroke } from './drawing'

/** Scale a polyline to fit the 0.1–0.9 box, aspect preserved and centered. */
function fit(pts: [number, number][]): Stroke {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const ext = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1
  const s = 0.8 / ext
  const ox = 0.5 - ((Math.max(...xs) - minX) * s) / 2
  const oy = 0.5 - ((Math.max(...ys) - minY) * s) / 2
  return pts.map(([x, y]) => ({ x: ox + (x - minX) * s, y: oy + (y - minY) * s }))
}

const ring = (n: number, f: (t: number) => [number, number]) =>
  Array.from({ length: n + 1 }, (_, i) => f((i / n) * 2 * Math.PI))

// Single closed strokes route best: no transit gaps.
export const STAMPS: { id: string; label: string; emoji: string; strokes: () => Stroke[] }[] = [
  {
    id: 'heart',
    label: 'Heart',
    emoji: '❤️',
    strokes: () => [
      fit(
        ring(60, (t) => [
          16 * Math.sin(t) ** 3,
          -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
        ]),
      ),
    ],
  },
  {
    id: 'star',
    label: 'Star',
    emoji: '⭐',
    // pentagram: connect every second vertex
    strokes: () => [
      fit(
        [0, 2, 4, 1, 3, 0].map((i): [number, number] => [
          Math.sin((i * 2 * Math.PI) / 5),
          -Math.cos((i * 2 * Math.PI) / 5),
        ]),
      ),
    ],
  },
  { id: 'circle', label: 'Circle', emoji: '⚪', strokes: () => [fit(ring(48, (t) => [Math.cos(t), Math.sin(t)]))] },
  { id: 'square', label: 'Square', emoji: '⬜', strokes: () => [fit([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])] },
  { id: 'triangle', label: 'Triangle', emoji: '🔺', strokes: () => [fit([[0.5, 0], [1, 0.87], [0, 0.87], [0.5, 0]])] },
  { id: 'bolt', label: 'Bolt', emoji: '⚡', strokes: () => [fit([[0.6, 0], [0.1, 0.55], [0.5, 0.55], [0.35, 1], [0.95, 0.4], [0.55, 0.4], [0.6, 0]])] },
  { id: 'house', label: 'House', emoji: '🏠', strokes: () => [fit([[0, 0.5], [0.5, 0], [1, 0.5], [1, 1], [0, 1], [0, 0.5]])] },
]
