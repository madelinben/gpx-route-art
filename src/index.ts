export type { BeforeExport } from "./export/gpx";
export { PlannerApp } from "./PlannerApp";
export { RouteArtApp } from "./RouteArtApp";

export const meta = {
  id: "route-art",
  title: "GPS Route Art",
  description: "Draw a shape or type a word and get a runnable GPX route on real streets",
} as const;

export const plannerMeta = {
  id: "route-planner",
  title: "Route Planner",
  description: "Plan a loop by distance or time and download it as GPX",
} as const;
