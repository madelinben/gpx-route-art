export type Mode = "distance" | "time";

/** Target loop length in meters from either a distance (km) or a time (minutes) at a pace (min/km). */
export function targetMeters(
  mode: Mode,
  km: number,
  minutes: number,
  paceMinPerKm: number
): number {
  switch (mode) {
    case "distance":
      return km * 1000;
    case "time":
      return (minutes / paceMinPerKm) * 1000;
    default:
      return mode satisfies never;
  }
}
