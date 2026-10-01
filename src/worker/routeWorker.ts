import { frame } from '../geo/geo'
import type { LatLon } from '../geo/geo'
import { fetchTile, tilesAround } from '../osm/overpass'
import { buildGraphFromTiles } from '../routing/graph'
import type { Tile } from '../routing/graph'
import { prepare } from '../routing/pipeline'
import { searchArea } from '../routing/solve'
import type { RouteResult } from '../routing/solve'

export type WorkerIn = {
  strokes: { x: number; y: number }[][]
  center: LatLon
  targetM: number
  tol: number
  /** Side of the square search area, meters. */
  areaM: number
}
export type WorkerOut =
  | { type: 'progress'; phase: 'tiles' | 'build' | 'search'; done: number; total: number }
  | { type: 'partial'; list: RouteResult[] }
  | { type: 'done'; list: RouteResult[]; warning?: string }
  | { type: 'error'; message: string }

const post = (m: WorkerOut) => postMessage(m)

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const { strokes, center, targetM, tol, areaM } = e.data
    const prep = prepare(strokes)
    if (!prep) throw new Error('Draw something first.')

    // 1. street data, three tiles at a time (Overpass allows a few slots per client)
    const bboxes = tilesAround(center, areaM)
    const tiles: Tile[] = []
    let next = 0
    let failed = 0
    post({ type: 'progress', phase: 'tiles', done: 0, total: bboxes.length })
    await Promise.all(
      [0, 1, 2].map(async () => {
        while (next < bboxes.length) {
          const b = bboxes[next++]
          try {
            tiles.push(await fetchTile(b))
          } catch {
            failed++
          }
          post({ type: 'progress', phase: 'tiles', done: tiles.length + failed, total: bboxes.length })
        }
      }),
    )
    if (!tiles.length) throw new Error('Could not load street data. Overpass may be busy — try again in a minute.')

    // 2. graph + search
    post({ type: 'progress', phase: 'build', done: 0, total: 1 })
    const g = buildGraphFromTiles(tiles, frame(center[0], center[1]).toXY)
    if (g.n < 2) throw new Error('No walkable streets found here. Try another location.')
    const list = searchArea(g, prep, {
      targetM,
      tol,
      center,
      areaM,
      onProgress: (done, total) => post({ type: 'progress', phase: 'search', done, total }),
      onPartial: (l) => post({ type: 'partial', list: l }),
    })
    post({
      type: 'done',
      list,
      warning: failed ? `${failed} of ${bboxes.length} map tiles failed to load, so part of the area was skipped.` : undefined,
    })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
