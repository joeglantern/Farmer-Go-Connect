import type { DB } from '@farmgo/db';

export interface Point {
  lat: number;
  lng: number;
}

/** Great-circle distance in km (used where a DB round trip is unnecessary). */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const hasPoint = (p: { lat: number | null; lng: number | null }): p is Point =>
  p.lat !== null && p.lng !== null;

/**
 * Farms within `radiusKm` of a point, nearest first, using PostGIS on geography.
 * Returns farm ids and distances; callers load details with Prisma.
 */
export async function farmsWithin(
  db: DB,
  point: Point,
  radiusKm: number,
): Promise<{ id: string; distanceKm: number }[]> {
  return db.$queryRawUnsafe<{ id: string; distanceKm: number }[]>(
    `SELECT id,
            ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS "distanceKm"
       FROM "Farm"
      WHERE lat IS NOT NULL AND lng IS NOT NULL AND active
        AND ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
      ORDER BY "distanceKm"`,
    point.lng,
    point.lat,
    radiusKm * 1000,
  );
}

/** Approximate county centroids, used when a farm or buyer has no coordinates. */
export const COUNTY_CENTROIDS: Record<string, Point> = {
  Nairobi: { lat: -1.2864, lng: 36.8172 },
  Kiambu: { lat: -1.1714, lng: 36.8356 },
  "Murang'a": { lat: -0.7839, lng: 37.04 },
  Nyeri: { lat: -0.4201, lng: 36.9476 },
  Kirinyaga: { lat: -0.659, lng: 37.3827 },
  Nyandarua: { lat: -0.1804, lng: 36.5223 },
  Nakuru: { lat: -0.3031, lng: 36.08 },
  Machakos: { lat: -1.5177, lng: 37.2634 },
  Kajiado: { lat: -1.8524, lng: 36.7768 },
  Meru: { lat: 0.047, lng: 37.6498 },
  Embu: { lat: -0.5388, lng: 37.4596 },
  Laikipia: { lat: 0.3606, lng: 36.7819 },
  Mombasa: { lat: -4.0435, lng: 39.6682 },
  Kilifi: { lat: -3.5107, lng: 39.9093 },
  Kwale: { lat: -4.1737, lng: 39.4521 },
  Kisumu: { lat: -0.0917, lng: 34.768 },
  Kakamega: { lat: 0.2827, lng: 34.7519 },
  Bungoma: { lat: 0.5635, lng: 34.5606 },
  'Uasin Gishu': { lat: 0.5143, lng: 35.2698 },
  'Trans Nzoia': { lat: 1.0567, lng: 34.9507 },
  Kericho: { lat: -0.3677, lng: 35.2831 },
  Bomet: { lat: -0.7813, lng: 35.3416 },
  Narok: { lat: -1.0875, lng: 35.8711 },
  Kisii: { lat: -0.6817, lng: 34.7667 },
  Nyamira: { lat: -0.5669, lng: 34.9341 },
  Makueni: { lat: -1.8039, lng: 37.62 },
  Kitui: { lat: -1.3747, lng: 38.0106 },
  'Taita Taveta': { lat: -3.3161, lng: 38.4849 },
  'Tharaka Nithi': { lat: -0.3072, lng: 37.7231 },
  Nandi: { lat: 0.1836, lng: 35.1269 },
  Baringo: { lat: 0.4919, lng: 35.743 },
  'Elgeyo Marakwet': { lat: 0.6788, lng: 35.5086 },
  Vihiga: { lat: 0.0764, lng: 34.7229 },
  Busia: { lat: 0.4608, lng: 34.1115 },
  Siaya: { lat: -0.0617, lng: 34.2422 },
  'Homa Bay': { lat: -0.5273, lng: 34.4571 },
  Migori: { lat: -1.0634, lng: 34.4731 },
  Isiolo: { lat: 0.3546, lng: 37.5822 },
  Marsabit: { lat: 2.3284, lng: 37.9899 },
  Samburu: { lat: 1.2155, lng: 36.9541 },
  'West Pokot': { lat: 1.6219, lng: 35.3905 },
  Turkana: { lat: 3.3122, lng: 35.5658 },
  Garissa: { lat: -0.4532, lng: 39.6461 },
  Wajir: { lat: 1.7471, lng: 40.0573 },
  Mandera: { lat: 3.9373, lng: 41.8569 },
  'Tana River': { lat: -1.5, lng: 40.0333 },
  Lamu: { lat: -2.2717, lng: 40.902 },
};

export function pointOrCentroid(p: { lat: number | null; lng: number | null }, county: string): Point | null {
  if (hasPoint(p)) return { lat: p.lat, lng: p.lng };
  return COUNTY_CENTROIDS[county] ?? null;
}
