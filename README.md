# gpx-route-art

Mobile-first single-page app: draw a shape or type a word, pick a location and distance,
and it routes the drawing onto real streets (OpenStreetMap via Overpass) and exports a GPX
for a watch (COROS Pace Pro). Built with TanStack Start (static SPA) + Leaflet.

Flow: **Draw** tab (canvas / word) → ⚙ Settings (location, distance, tolerance) → Generate →
**Map** tab (route, score) → Download GPX. Routing runs in a Web Worker
(`src/routing`, `src/worker`).

- Spec: [docs/BRIEF.md](docs/BRIEF.md)
- Deploy: [DEPLOYMENT.md](DEPLOYMENT.md)

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # vitest
pnpm build      # static site in dist/client
```
