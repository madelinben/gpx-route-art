import type { LatLon } from '../geo/geo'
import type { RouteResult } from '../routing/solve'
import { loadGraph } from '../worker/loadGraph'
import { planLoops, toRouteResult } from './loop'

export type PlanIn = { center: LatLon; targetM: number; tol: number }
export type PlanOut =
  | { type: 'progress'; phase: 'tiles' | 'build'; done: number; total: number }
  | { type: 'done'; list: RouteResult[]; warning?: string }
  | { type: 'error'; message: string }

const post = (m: PlanOut) => postMessage(m)

// Loop reach is ~0.27 × length from the start; search a square comfortably larger than that.
const areaFor = (targetM: number) => Math.min(12_000, Math.max(3_000, targetM * 0.9))

self.onmessage = async (e: MessageEvent<PlanIn>) => {
  try {
    const { center, targetM, tol } = e.data
    const { g, failed, total } = await loadGraph(center, areaFor(targetM), (phase, done, t) =>
      post({ type: 'progress', phase, done, total: t }),
    )
    const list = planLoops(g, targetM, tol).map((l) => toRouteResult(g, l, center, tol))
    post({
      type: 'done',
      list,
      warning: failed ? `${failed} of ${total} map tiles failed to load, so some streets may be missing.` : undefined,
    })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
