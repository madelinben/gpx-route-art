import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { LatLon } from '../geo/geo'
import type { RouteResult } from '../routing/solve'

const TILES =
  (import.meta.env.VITE_TILE_URL as string | undefined) ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

const emoji = (e: string, anchor: [number, number]) =>
  L.divIcon({ html: e, className: 'emoji-pin', iconSize: [30, 30], iconAnchor: anchor })
const PIN = emoji('📍', [15, 28])
const START = emoji('🏁', [4, 26])
const FINISH = emoji('🏆', [15, 26])

function Fit({ pin, preview, result }: { pin: LatLon | null; preview: LatLon[][] | null; result: RouteResult | null }) {
  const map = useMap()
  const pts = useMemo(
    () => (result ? result.segments.flatMap((s) => s.pts) : (preview?.flat() ?? [])),
    [result, preview],
  )
  // Refit when the route/preview changes or the map box resizes (stats panel appears).
  useEffect(() => {
    const fit = () => {
      map.invalidateSize()
      if (pts.length) map.fitBounds(pts, { padding: [30, 30] })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map, pts])
  // A moved pin recenters the map only if it left the view.
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
  const all = result?.segments.flatMap((s) => s.pts)
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
          <Polyline key={i} positions={pts} pathOptions={{ color: '#2fa7e0', weight: 4, dashArray: '2 9', lineCap: 'round' }} />
        ))}
      {result?.segments.map((s, i) => (
        // white casing under the colored line so the route pops off the map
        <Polyline key={`c${i}`} positions={s.pts} pathOptions={{ color: '#fff', weight: 10, opacity: 0.9, lineCap: 'round' }} />
      ))}
      {result?.segments.map((s, i) => (
        <Polyline
          key={i}
          positions={s.pts}
          pathOptions={
            s.transit
              ? { color: '#2fa7e0', weight: 5, dashArray: '8 8' }
              : { color: '#ff6b35', weight: 6, lineCap: 'round', lineJoin: 'round' }
          }
        />
      ))}
      {all && (
        <>
          <Marker position={all[0]} icon={START} interactive={false} />
          <Marker position={all[all.length - 1]} icon={FINISH} interactive={false} />
        </>
      )}
      {pin && !result && <Marker position={pin} icon={PIN} interactive={false} />}
      {pin && result && (
        <CircleMarker center={pin} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }} />
      )}
    </MapContainer>
  )
}
