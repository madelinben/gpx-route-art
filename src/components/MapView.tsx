import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { LatLon } from '../geo/geo'
import type { RouteResult } from '../routing/solve'

const TILES =
  (import.meta.env.VITE_TILE_URL as string | undefined) ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

function Fit({ pin, preview, result }: { pin: LatLon | null; preview: LatLon[][] | null; result: RouteResult | null }) {
  const map = useMap()
  // Refit when the route/preview changes; for a moved pin only if it left the view.
  useEffect(() => {
    const pts = result ? result.segments.flatMap((s) => s.pts) : (preview?.flat() ?? [])
    if (pts.length) map.fitBounds(pts, { padding: [30, 30] })
  }, [map, result, preview])
  useEffect(() => {
    if (pin && !map.getBounds().contains(pin)) map.setView(pin, Math.max(map.getZoom(), 14))
  }, [map, pin])
  return null
}

function Picker({ onPin }: { onPin: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPin([e.latlng.lat, e.latlng.lng]) })
  return null
}

export default function MapView({
  pin,
  onPin,
  preview,
  result,
}: {
  pin: LatLon | null
  onPin: (p: LatLon) => void
  preview: LatLon[][] | null
  result: RouteResult | null
}) {
  return (
    <MapContainer className="map" center={pin ?? [51.505, -0.09]} zoom={pin ? 14 : 5} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url={TILES}
      />
      <Fit pin={pin} preview={preview} result={result} />
      <Picker onPin={onPin} />
      {!result &&
        preview?.map((pts, i) => (
          <Polyline key={i} positions={pts} pathOptions={{ color: '#6b7280', weight: 3, dashArray: '4 6' }} />
        ))}
      {result?.segments.map((s, i) => (
        <Polyline
          key={i}
          positions={s.pts}
          pathOptions={
            s.transit
              ? { color: '#2563eb', weight: 4, dashArray: '8 8' }
              : { color: '#f97316', weight: 5, lineCap: 'round' }
          }
        />
      ))}
      {pin && (
        <CircleMarker center={pin} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }} />
      )}
    </MapContainer>
  )
}
