import type { RouteResult } from '../routing/solve'

export type MetricId = 'score' | 'shape' | 'dist' | 'clean'

export const METRICS: {
  id: MetricId
  label: string
  /** Higher is better after this transform. */
  key: (r: RouteResult) => number
  fmt: (r: RouteResult) => string
}[] = [
  { id: 'score', label: '🏆 Overall', key: (r) => r.score, fmt: (r) => `${r.score}` },
  { id: 'shape', label: '🔷 Shape', key: (r) => r.fidelity, fmt: (r) => `${Math.round(r.fidelity * 100)}%` },
  { id: 'dist', label: '🎯 Distance', key: (r) => -r.errPct, fmt: (r) => `±${(r.errPct * 100).toFixed(1)}%` },
  { id: 'clean', label: '🧼 Clean', key: (r) => r.clean, fmt: (r) => `${Math.round(r.clean * 100)}%` },
]

export const rank = (list: RouteResult[], id: MetricId) => {
  const m = METRICS.find((x) => x.id === id)!
  return [...list].sort((a, b) => m.key(b) - m.key(a) || b.score - a.score).slice(0, 6)
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function where(off: [number, number]) {
  const d = Math.hypot(off[0], off[1])
  if (d < 250) return 'at pin'
  const dir = COMPASS[Math.round((Math.atan2(off[0], off[1]) / (2 * Math.PI)) * 8 + 8) % 8]
  return `${(d / 1000).toFixed(1)} km ${dir}`
}

const W = 76
const H = 54

/** Tiny route outline, scaled to fit. */
function Thumb({ r }: { r: RouteResult }) {
  const lat0 = r.segments[0].pts[0][0]
  const k = Math.cos((lat0 * Math.PI) / 180)
  const all = r.segments.flatMap((s) => s.pts.map((p): [number, number] => [p[1] * k, -p[0]]))
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const s = Math.min((W - 8) / (Math.max(...xs) - minX || 1), (H - 8) / (Math.max(...ys) - minY || 1))
  const ox = (W - (Math.max(...xs) - minX) * s) / 2
  const oy = (H - (Math.max(...ys) - minY) * s) / 2
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {r.segments.map((seg, i) => {
        const stride = Math.max(1, Math.floor(seg.pts.length / 80))
        const d = seg.pts
          .filter((_, j) => j % stride === 0 || j === seg.pts.length - 1)
          .map((p, j) => `${j ? 'L' : 'M'}${(ox + (p[1] * k - minX) * s).toFixed(1)},${(oy + (-p[0] - minY) * s).toFixed(1)}`)
          .join('')
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={seg.transit ? '#2fa7e0' : '#ff6b35'}
            strokeWidth={seg.transit ? 1.5 : 2.5}
            strokeDasharray={seg.transit ? '3 3' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

export function Variations({
  list,
  metric,
  onMetric,
  selected,
  onSelect,
  open,
  onToggle,
}: {
  list: RouteResult[]
  metric: MetricId
  onMetric: (m: MetricId) => void
  selected: RouteResult | null
  onSelect: (r: RouteResult) => void
  open: boolean
  onToggle: () => void
}) {
  const ranked = rank(list, metric)
  const m = METRICS.find((x) => x.id === metric)!
  return (
    <section className="vars" aria-label="Route variations">
      <div className="vtabs" role="tablist">
        {METRICS.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === metric} onClick={() => onMetric(x.id)}>
            {x.label}
          </button>
        ))}
        <button className="vtoggle" aria-label={open ? 'Hide variations' : 'Show variations'} onClick={onToggle}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="vcards">
          {ranked.map((r, i) => (
            <button
              key={`${r.off[0]}|${r.off[1]}|${r.rotationDeg}`}
              className="vcard"
              aria-pressed={r === selected}
              onClick={() => onSelect(r)}
            >
              <span className="rank">#{i + 1}</span>
              <Thumb r={r} />
              <b>{m.fmt(r)}</b>
              <small>{where(r.off)}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
