const URL_ = (import.meta.env.VITE_NOMINATIM_URL as string | undefined) ?? 'https://nominatim.openstreetmap.org'

export type Place = { name: string; lat: number; lon: number }

// Called only on explicit submit (policy: ≤1 req/s, no per-keystroke autocomplete).
const cache = new Map<string, Place[]>()

export async function searchPlaces(q: string): Promise<Place[]> {
  const key = q.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(`${URL_}/search?format=json&limit=5&q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[]
  const out = rows.map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }))
  cache.set(key, out)
  return out
}
