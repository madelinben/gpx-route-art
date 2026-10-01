# gpx-route-art

Mobile-first single-page app: draw a shape or type a word, pick a location and distance,
and it routes the drawing onto real streets (OpenStreetMap via Overpass) and exports a GPX
for a watch (COROS Pace Pro). Built with TanStack Start (static SPA) + Leaflet.

The canvas has a dotted grid scaled to your target distance (dots ≈ 100 m, rings ≈ 1 km)
and one-tap shape stamps (heart, star, …).

It searches a 3, 6 or 10 km square around your pin for the placements (position × rotation)
where the drawing fits the streets best, then ranks the variations by overall score, shape,
distance accuracy and cleanliness (no doubling back). Map tiles are cached for the session.

Flow: **Draw** tab (canvas / word) → ⚙ Settings (location, distance, tolerance) → Find best spots →
**Map** tab (ranked variations, score) → Download GPX. Routing runs in a Web Worker
(`src/routing`, `src/worker`).

- Spec: [docs/BRIEF.md](docs/BRIEF.md)
- Deploy: [DEPLOYMENT.md](DEPLOYMENT.md)

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # vitest
pnpm build      # static site in dist/client
```
