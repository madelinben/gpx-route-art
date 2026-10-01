import type { Stroke } from './drawing'
import font from './futural.json' // Hershey "futural" single-stroke font (EMSL data), chars 33..127

const chars = font as [number, string][]
const SPACE = 16
const CAP = 22 // glyph height in font units

/** Text → single-stroke polylines in normalized 0–1 square coords (fit to width, centered). */
export function textStrokes(text: string): Stroke[] {
  const strokes: Stroke[] = []
  let x = 0
  for (const ch of text.toUpperCase()) {
    const g = chars[ch.charCodeAt(0) - 33] as [number, string] | undefined
    if (!g) {
      x += SPACE
      continue
    }
    for (const path of g[1].split('M').filter(Boolean)) {
      const pts = path
        .replace(/L/g, ' ')
        .trim()
        .split(/\s+/)
        .map((p) => p.split(',').map(Number))
        .map(([px, py]) => ({ x: x + px, y: py }))
      if (pts.length) strokes.push(pts)
    }
    x += 2 * g[0] // font `o` is the glyph's center offset, so advance ≈ 2·o
  }
  if (!strokes.length) return []
  const s = 0.9 / Math.max(x, CAP) // fit 90% of the square's width
  const oy = 0.5 - (CAP * s) / 2
  const ox = (1 - x * s) / 2
  return strokes.map((st) => st.map((p) => ({ x: ox + p.x * s, y: oy + (p.y - 0) * s })))
}
