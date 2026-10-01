import type { LatLon } from '../geo/geo'
import type { OverpassElement } from '../routing/graph'

const URLS = (import.meta.env.VITE_OVERPASS_URL as string | undefined)
  ? [import.meta.env.VITE_OVERPASS_URL as string]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export type Bbox = { s: number; w: number; n: number; e: number }

/** Square bbox of `halfM` meters around center. */
export function bboxAround([lat, lon]: LatLon, halfM: number): Bbox {
  const dLat = halfM / 111_320
  const dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon }
}

// Run/walk profile: no motorways/trunks, no private access. Bike mode is a future add.
const query = (b: Bbox) => `[out:json][timeout:25];
(way["highway"~"^(footway|path|pedestrian|residential|living_street|service|tertiary|secondary|primary|unclassified|track|cycleway|steps)$"]["access"!~"private|no"](${b.s},${b.w},${b.n},${b.e}););
(._;>;);
out skel qt;`

const contains = (a: Bbox, b: Bbox) => a.s <= b.s && a.w <= b.w && a.n >= b.n && a.e >= b.e

// ponytail: one-entry in-memory cache (re-generating with a new distance in the same
// area is free); upgrade to IndexedDB keyed by rounded bbox if cross-session reuse matters.
let cached: { bbox: Bbox; elements: OverpassElement[] } | null = null

export async function fetchElements(bbox: Bbox, signal?: AbortSignal): Promise<OverpassElement[]> {
  if (cached && contains(cached.bbox, bbox)) return cached.elements
  let lastErr: unknown
  for (const url of URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query(bbox) }),
        signal,
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const json = (await res.json()) as { elements: OverpassElement[] }
      cached = { bbox, elements: json.elements }
      return json.elements
    } catch (e) {
      if (signal?.aborted) throw e
      lastErr = e
    }
  }
  throw new Error(`Could not load street data (${lastErr instanceof Error ? lastErr.message : lastErr})`)
}
