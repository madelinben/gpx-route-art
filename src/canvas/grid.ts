const STEPS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000]

/**
 * Dot-grid spec for the canvas: minor dots at the finest "nice" distance that is still
 * ≥ 14 px apart (100 m for a typical run), major rings every 10× (1 km).
 */
export function gridSpec(mPerSquare: number, sidePx: number) {
  const pxPerM = sidePx / mPerSquare
  const minorM = STEPS.find((m) => m * pxPerM >= 14) ?? STEPS[STEPS.length - 1]
  return { minorM, majorM: minorM * 10, minorPx: minorM * pxPerM }
}

export const fmtDist = (m: number) => (m < 1000 ? `${m} m` : `${+(m / 1000).toFixed(1)} km`)
