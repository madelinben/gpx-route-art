# Deployment — GitHub Pages

The app builds to a static SPA (`dist/client`) and is deployed by
`.github/workflows/pages.yml` on every push to `main`.

Live URL: https://madelinben.github.io/gpx-route-art/

## One-time setup

1. Create the repo `madelinben/gpx-route-art` on GitHub (empty, no README).
   It must be **public** for a public site (private repos need a paid plan for Pages).
2. Push the code:
   ```bash
   git remote add origin git@github.com:madelinben/gpx-route-art.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Run **Actions → Deploy Pages → Run workflow** (or push to `main`). The first run
   creates the `github-pages` environment; if it fails with a 404 on `configure-pages`,
   step 3 wasn't saved yet.
5. Open the live URL. HTTPS is automatic, which the Geolocation API requires.

## Every deploy after that

Push to `main`. The workflow runs lint, typecheck, tests, builds, and publishes.
Check progress under the **Actions** tab.

## Local check of the production build

```bash
pnpm build
pnpm preview   # http://localhost:4173/gpx-route-art/
```

## Notes

- `vite.config.ts` sets `base: '/gpx-route-art/'` and `src/router.tsx` derives the router
  basepath from it. Rename the repo or use a custom domain → update `base` (use `/` for a
  custom domain).
- `pnpm build` copies `index.html` to `404.html` so deep links (e.g. `/gpx-route-art/map`)
  load the SPA on refresh.
- The pnpm version comes from `packageManager` in `package.json`.

## Optional build-time config

`VITE_OVERPASS_URL`, `VITE_NOMINATIM_URL` and `VITE_TILE_URL` override the public OSM
endpoints (defaults need no setup). Set them as repository **variables** (not secrets) and
pass them via `env:` on the workflow's build step. They end up in the public bundle.

## Secrets

The app needs **none**: Overpass, Nominatim and OSM tiles are keyless, and Pages deploys
via the workflow's built-in OIDC token.

- Never commit `.env*` files (git-ignored except `.env.example`), keys or tokens.
- Any `VITE_*` variable is bundled into the public JS. Treat it as public.
- Before pushing, scan: `git ls-files | grep -iE '\.env|\.pem|\.key'` should print nothing.
