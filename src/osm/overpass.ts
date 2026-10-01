import type { LatLon } from '../geo/geo'
import type { OverpassElement, Tile } from '../routing/graph'
import { compactElements } from '../routing/graph'

const URLS = (import.meta.env.VITE_OVERPASS_URL as string | undefined)
  ? [import.meta.env.VITE_OVERPASS_URL as string]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export type Bbox = { s: number; w: number; n: number; e: number }

/** Split a square area around `center` into ~`tileM` bounding boxes. */
export function tilesAround([lat, lon]: LatLon, areaM: number, tileM = 2500): Bbox[] {
  const dLat = areaM / 2 / 111_320
  const dLon = areaM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180))
  const n = Math.max(1, Math.ceil(areaM / tileM))
  const tiles: Bbox[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      tiles.push({
        s: lat - dLat + (2 * dLat * i) / n,
        n: lat - dLat + (2 * dLat * (i + 1)) / n,
        w: lon - dLon + (2 * dLon * j) / n,
        e: lon - dLon + (2 * dLon * (j + 1)) / n,
      })
    }
  }
  return tiles
}

// Run/walk profile: no motorways/trunks, no private access. Bike mode is a future add.
const query = (b: Bbox) => `[out:json][timeout:25];
(way["highway"~"^(footway|path|pedestrian|residential|living_street|service|tertiary|secondary|primary|unclassified|track|cycleway|steps)$"]["access"!~"private|no"](${b.s},${b.w},${b.n},${b.e}););
(._;>;);
out skel qt;`

// Tiles are kept compact in memory for the life of the worker, so re-running a search in the
// same area (new distance, tolerance, drawing) skips the network.
// ponytail: in-memory only; upgrade to IndexedDB if cross-session reuse matters.
const cache = new Map<string, Tile>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchTile(b: Bbox): Promise<Tile> {
  const k = [b.s, b.w, b.n, b.e].map((v) => v.toFixed(5)).join(',')
  const hit = cache.get(k)
  if (hit) return hit
  let lastErr: unknown
  for (let round = 0; round < 2; round++) {
    for (const url of URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ data: query(b) }),
          signal: AbortSignal.timeout(45_000), // a hung mirror must not stall the whole search
        })
        if (!res.ok) throw new Error(`Overpass ${res.status}`)
        const json = (await res.json()) as { elements: OverpassElement[] }
        const tile = compactElements(json.elements)
        cache.set(k, tile)
        return tile
      } catch (e) {
        lastErr = e
      }
    }
    await sleep(2500) // busy servers (429/504) usually recover within a few seconds
  }
  throw new Error(`Could not load street data (${lastErr instanceof Error ? lastErr.message : lastErr})`)
}
