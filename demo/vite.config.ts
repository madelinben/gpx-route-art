import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone GitHub Pages SPA (deployed by .github/workflows/pages.yml from dist/client).
export default defineConfig({
  root: import.meta.dirname,
  base: "/gpx-route-art/",
  plugins: [react()],
  worker: { format: "es" },
  server: { port: 3000 },
  build: { outDir: "../dist/client", emptyOutDir: true },
});
