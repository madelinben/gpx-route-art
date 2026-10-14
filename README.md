# gpx-route-art

Mobile-first app: draw a shape or type a word, pick a location and distance, and it routes the drawing onto real streets (OpenStreetMap via Overpass) and exports a GPX for a watch or Strava. Leaflet map, routing in a Web Worker (`src/routing`, `src/worker`).

Flow: **Draw** tab (canvas / word) → ⚙ Settings (location, distance, tolerance) → Find best spots → **Map** tab (ranked variations, score) → Download GPX.

Two ways this repo ships, from the same `src/`:

| Target | How |
|---|---|
| **GitHub Pages** (`madelinben.github.io/gpx-route-art/`) | `.github/workflows/pages.yml` builds `demo/` → `dist/client` (Pages source: GitHub Actions) |
| **get-out-there** (Cloudflare) | imported as workspace package `@get-out-there/tool-route-art` (`RouteArtApp`, `./styles.css`) |

```bash
pnpm install
pnpm dev          # demo at http://localhost:3000/gpx-route-art/
pnpm test         # vitest
pnpm typecheck
pnpm build        # static site -> dist/client
```

Package rules: no router/auth/app imports; all CSS is scoped under `.gpxa` (keyframes `gpxa-*`) so it can't leak into a host page; pass `embedded` when mounted inside another layout.

Spec: [docs/BRIEF.md](docs/BRIEF.md) · Deploy: [DEPLOYMENT.md](DEPLOYMENT.md)
