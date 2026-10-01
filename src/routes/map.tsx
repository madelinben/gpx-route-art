import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/map')({ component: MapView })

// ponytail: stub — Leaflet + location picker land in milestone 2.
function MapView() {
  return (
    <div className="screen">
      <header className="bar">
        <Link to="/">Back</Link>
      </header>
      <main>Map coming soon</main>
      <footer />
    </div>
  )
}
