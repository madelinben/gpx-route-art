import type { LatLon, XY } from '../geo/geo'
import { frame, rdp } from '../geo/geo'

const esc = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** RDP-downsample (meters) to at most `max` points; turns survive because RDP keeps corners. */
export function downsample(pts: LatLon[], max: number): LatLon[] {
  if (pts.length <= max) return pts
  const f = frame(pts[0][0], pts[0][1])
  const xy = pts.map((p) => f.toXY(p[0], p[1]))
  let lo = 0
  let hi = 1000
  let out: XY[] = rdp(xy, hi)
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const r = rdp(xy, mid)
    if (r.length > max) lo = mid
    else {
      hi = mid
      out = r
    }
  }
  return out.map((p) => f.toLatLon(p))
}

export function buildGpx(o: {
  name: string
  desc: string
  pts: LatLon[]
  kind: 'trk' | 'rte'
  maxPoints?: number
}) {
  const pts = downsample(o.pts, o.maxPoints ?? 1000)
  const c = (n: number) => n.toFixed(6) // '.' decimal regardless of locale
  const body =
    o.kind === 'trk'
      ? `<trk><name>${esc(o.name)}</name><trkseg>\n${pts.map((p) => `<trkpt lat="${c(p[0])}" lon="${c(p[1])}"/>`).join('\n')}\n</trkseg></trk>`
      : `<rte><name>${esc(o.name)}</name>\n${pts.map((p) => `<rtept lat="${c(p[0])}" lon="${c(p[1])}"/>`).join('\n')}\n</rte>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPS Art Generator" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(o.name)}</name><desc>${esc(o.desc)}</desc><copyright author="OpenStreetMap contributors"><license>https://www.openstreetmap.org/copyright</license></copyright></metadata>
${body}
</gpx>
`
}

export const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'drawing'

export const gpxFileName = (shape: string, km: number, d = new Date()) =>
  `gps-art_${safeName(shape)}_${km.toFixed(1)}km_${d.toISOString().slice(0, 10)}.gpx`

/** Must be called synchronously from a tap handler (Safari blocks downloads after an await). */
// lib.dom types canShare as always present; older browsers lack it.
const canShareData = (d: ShareData) => (navigator as { canShare?: (d: ShareData) => boolean }).canShare?.(d) ?? false

export function shareOrDownload(gpx: string, fileName: string, title: string, share: boolean) {
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' })
  if (share && canShareData({ files: [file] })) {
    navigator.share({ files: [file], title }).catch(() => download(file))
    return
  }
  download(file)
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000) // iOS needs the URL alive briefly
}

export const canShareFiles = () =>
  typeof navigator !== 'undefined' && canShareData({ files: [new File([''], 'a.gpx', { type: 'application/gpx+xml' })] })
