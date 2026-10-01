import { frame } from '../geo/geo'
import type { LatLon } from '../geo/geo'
import { buildGraph } from '../routing/graph'
import type { OverpassElement } from '../routing/graph'
import { prepare } from '../routing/pipeline'
import { solve } from '../routing/solve'
import type { RouteResult } from '../routing/solve'

export type WorkerIn = {
  elements: OverpassElement[]
  strokes: { x: number; y: number }[][]
  center: LatLon
  targetM: number
  tol: number
}
export type WorkerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'best'; result: RouteResult }
  | { type: 'done'; result: RouteResult | null }
  | { type: 'error'; message: string }

const post = (m: WorkerOut) => postMessage(m)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  try {
    const { elements, strokes, center, targetM, tol } = e.data
    const f = frame(center[0], center[1])
    const g = buildGraph(elements, f.toXY)
    if (g.n < 2) throw new Error('No walkable streets found here. Try another location.')
    const prep = prepare(strokes)
    if (!prep) throw new Error('Draw something first.')
    const result = solve(g, prep, {
      targetM,
      tol,
      center,
      onBest: (r) => post({ type: 'best', result: r }),
      onProgress: (done, total) => post({ type: 'progress', done, total }),
    })
    post({ type: 'done', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
