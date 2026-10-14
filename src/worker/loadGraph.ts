import { frame } from '../geo/geo'
import type { LatLon } from '../geo/geo'
import { fetchTile, tilesAround } from '../osm/overpass'
import { buildGraphFromTiles } from '../routing/graph'
import type { Graph, Tile } from '../routing/graph'

export type LoadProgress = (phase: 'tiles' | 'build', done: number, total: number) => void

/** Download street data around `center` and build the walkable graph (origin = center, meters). */
export async function loadGraph(
  center: LatLon,
  areaM: number,
  onProgress: LoadProgress,
): Promise<{ g: Graph; failed: number; total: number }> {
  // street data, three tiles at a time (Overpass allows a few slots per client)
  const bboxes = tilesAround(center, areaM)
  const tiles: Tile[] = []
  let next = 0
  let failed = 0
  onProgress('tiles', 0, bboxes.length)
  await Promise.all(
    [0, 1, 2].map(async () => {
      while (next < bboxes.length) {
        const b = bboxes[next++]
        try {
          tiles.push(await fetchTile(b))
        } catch {
          failed++
        }
        onProgress('tiles', tiles.length + failed, bboxes.length)
      }
    }),
  )
  if (!tiles.length) throw new Error('Could not load street data. Overpass may be busy — try again in a minute.')

  onProgress('build', 0, 1)
  const g = buildGraphFromTiles(tiles, frame(center[0], center[1]).toXY)
  if (g.n < 2) throw new Error('No walkable streets found here. Try another location.')
  return { g, failed, total: bboxes.length }
}
