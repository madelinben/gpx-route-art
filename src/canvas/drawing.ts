export type Pt = { x: number; y: number }
export type Stroke = Pt[]
/** Strokes in normalized 0–1 coords of a square drawing area. */
export type Drawing = { strokes: Stroke[] }

/** Largest centered square inside a w×h box. */
export function squareOf(w: number, h: number) {
  const side = Math.min(w, h)
  return { side, ox: (w - side) / 2, oy: (h - side) / 2 }
}

/** Box-local px → normalized square coords (may fall outside 0–1 in the letterbox; clamped). */
export function toNorm(px: number, py: number, w: number, h: number): Pt {
  const { side, ox, oy } = squareOf(w, h)
  const c = (v: number) => Math.min(1, Math.max(0, v))
  return { x: c((px - ox) / side), y: c((py - oy) / side) }
}

export function toPx(p: Pt, w: number, h: number): Pt {
  const { side, ox, oy } = squareOf(w, h)
  return { x: ox + p.x * side, y: oy + p.y * side }
}
