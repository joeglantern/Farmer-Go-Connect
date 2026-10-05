'use dom';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

export type MarkerKind = 'farm' | 'buyer' | 'driver' | 'pin';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  label?: string;
}

interface Props {
  markers: MapMarker[];
  /** Polyline through these points (route). */
  path?: [number, number][];
  dark?: boolean;
  height?: number;
  /** Tap to place a pin (location picker); reports the chosen point. */
  pickable?: boolean;
  onPick?: (lat: number, lng: number) => void;
  center?: [number, number];
  zoom?: number;
  dom?: import('expo/dom').DOMProps;
}

const COLORS: Record<MarkerKind, { fill: string; ring: string; glyph: string }> = {
  farm: {
    fill: '#1C6536',
    ring: '#FFFFFF',
    glyph: '<path d="M6 13 C 6 8 9 6 12 5 C 12 9 10 12 6 13 Z" fill="#B9CF4B"/>',
  },
  buyer: {
    fill: '#0E3B22',
    ring: '#FFFFFF',
    glyph: '<rect x="7" y="6" width="6" height="8" rx="1" fill="#FFFFFF"/>',
  },
  driver: {
    fill: '#E58A2B',
    ring: '#FFFFFF',
    glyph:
      '<rect x="5" y="7" width="7" height="5" rx="1" fill="#FFFFFF"/><rect x="12" y="8.5" width="3.5" height="3.5" rx="0.8" fill="#FFFFFF"/>',
  },
  pin: { fill: '#1C6536', ring: '#FFFFFF', glyph: '<circle cx="10" cy="10" r="3" fill="#FFFFFF"/>' },
};

// OpenStreetMap tiles by default (fine for development and light use). Production sets
// EXPO_PUBLIC_MAP_TILES to a keyed provider, e.g. MapTiler: https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=...
const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILES || DEFAULT_TILES;
const TILE_ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors';

// The stock OSM style is loud next to the app; soften it, and derive a night version.
const TILE_CSS = `
.fg-tiles-light { filter: saturate(0.4) contrast(0.92) brightness(1.05); }
.fg-tiles-dark { filter: invert(1) hue-rotate(180deg) saturate(0.35) brightness(0.85) contrast(0.9); }
.leaflet-container { font-family: Figtree, system-ui, sans-serif; }
.leaflet-tooltip { border-radius: 8px; border: 0; box-shadow: 0 4px 14px rgba(13,36,24,.18); font-weight: 600; }
`;

function icon(kind: MarkerKind) {
  const c = COLORS[kind];
  const size = kind === 'driver' ? 40 : 34;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, kind === 'pin' ? size : size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 20 20" style="filter: drop-shadow(0 2px 3px rgba(13,36,24,.35))"><circle cx="10" cy="10" r="9" fill="${c.fill}" stroke="${c.ring}" stroke-width="1.6"/>${c.glyph}</svg>`,
  });
}

/**
 * One map for every platform (Expo DOM component: a web view on phones, plain DOM on web).
 * CARTO basemaps over OpenStreetMap data, light or dark to match the app theme.
 */
export default function LeafletMap({
  markers,
  path,
  dark,
  height = 260,
  pickable,
  onPick,
  center,
  zoom = 12,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once; later prop changes are applied by the effects below
  useEffect(() => {
    if (!el.current || map.current) return;
    if (!document.getElementById('fg-map-css')) {
      const style = document.createElement('style');
      style.id = 'fg-map-css';
      style.textContent = TILE_CSS;
      document.head.appendChild(style);
    }
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    m.setView(center ?? [-1.2864, 36.8172], zoom);
    if (pickable) {
      m.on('click', (e: L.LeafletMouseEvent) =>
        onPick?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))),
      );
    }
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      className: TILE_URL === DEFAULT_TILES ? (dark ? 'fg-tiles-dark' : 'fg-tiles-light') : '',
    }).addTo(m);
  }, [dark]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (path && path.length > 1) {
      L.polyline(path, {
        color: dark ? '#7FC593' : '#1C6536',
        weight: 4,
        opacity: 0.85,
        dashArray: '1 8',
        lineCap: 'round',
      }).addTo(g);
    }
    for (const mk of markers) {
      const marker = L.marker([mk.lat, mk.lng], {
        icon: icon(mk.kind),
        title: mk.label,
        keyboard: true,
      }).addTo(g);
      if (mk.label) marker.bindTooltip(mk.label, { direction: 'top', offset: [0, -14] });
    }
    const pts: [number, number][] = [
      ...markers.map((mk) => [mk.lat, mk.lng] as [number, number]),
      ...(path ?? []),
    ];
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    else if (pts.length === 1) m.setView(pts[0]!, Math.max(zoom, 14));
  }, [markers, path, dark, zoom]);

  return (
    <div
      ref={el}
      style={{
        width: '100%',
        height,
        borderRadius: 16,
        overflow: 'hidden',
        background: dark ? '#10281A' : '#E9F2E4',
      }}
    />
  );
}
