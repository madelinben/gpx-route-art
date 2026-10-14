import type { LatLon } from "../geo/geo";
import { prepare } from "../routing/pipeline";
import type { RouteResult } from "../routing/solve";
import { searchArea } from "../routing/solve";
import { loadGraph } from "./loadGraph";

export type WorkerIn = {
  strokes: { x: number; y: number }[][];
  center: LatLon;
  targetM: number;
  tol: number;
  /** Side of the square search area, meters. */
  areaM: number;
};
export type WorkerOut =
  | { type: "progress"; phase: "tiles" | "build" | "search"; done: number; total: number }
  | { type: "partial"; list: RouteResult[] }
  | { type: "done"; list: RouteResult[]; warning?: string }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const { strokes, center, targetM, tol, areaM } = e.data;
    const prep = prepare(strokes);
    if (!prep) throw new Error("Draw something first.");

    const { g, failed, total } = await loadGraph(center, areaM, (phase, done, t) =>
      post({ type: "progress", phase, done, total: t })
    );
    const list = searchArea(g, prep, {
      targetM,
      tol,
      center,
      areaM,
      onProgress: (done, t) => post({ type: "progress", phase: "search", done, total: t }),
      onPartial: (l) => post({ type: "partial", list: l }),
    });
    post({
      type: "done",
      list,
      warning: failed
        ? `${failed} of ${total} map tiles failed to load, so part of the area was skipped.`
        : undefined,
    });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
