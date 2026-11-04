// Small geometry helpers for the zone editor (UX only; PostGIS is authoritative).

export type Position = [number, number];
export type Polygon = { type: "Polygon"; coordinates: Position[][] };
export type MultiPolygon = { type: "MultiPolygon"; coordinates: Position[][][] };
export type ZoneGeometry = Polygon | MultiPolygon;

export const DHAKA: Position = [90.4125, 23.8103];

const R = 6_378_137; // WGS84 equatorial radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** Spherical ring area in m² (same approach as turf/area). */
function ringArea(ring: Position[]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    total += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((total * R * R) / 2);
}

export function areaKm2(geometry: ZoneGeometry): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const m2 = polygons.reduce((sum, rings) => {
    const [outer, ...holes] = rings;
    return sum + (outer ? ringArea(outer) : 0) - holes.reduce((h, ring) => h + ringArea(ring), 0);
  }, 0);
  return m2 / 1e6;
}

export function polygonsOf(geometry: ZoneGeometry): Polygon[] {
  return geometry.type === "Polygon"
    ? [geometry]
    : geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
}

export function combine(polygons: Polygon[]): ZoneGeometry | null {
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return polygons[0]!;
  return { type: "MultiPolygon", coordinates: polygons.map((p) => p.coordinates) };
}

export function bounds(geometries: ZoneGeometry[]): [Position, Position] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of geometries) {
    for (const p of polygonsOf(g)) {
      for (const [x, y] of p.coordinates[0] ?? []) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/** Accepts a GeoJSON Feature, FeatureCollection or bare (Multi)Polygon. */
export function parseZoneGeoJson(text: string): ZoneGeometry | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const geometries: ZoneGeometry[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as { type?: string; geometry?: unknown; features?: unknown[]; coordinates?: unknown };
    if (obj.type === "FeatureCollection") obj.features?.forEach(visit);
    else if (obj.type === "Feature") visit(obj.geometry);
    else if ((obj.type === "Polygon" || obj.type === "MultiPolygon") && Array.isArray(obj.coordinates)) {
      geometries.push(obj as ZoneGeometry);
    }
  };
  visit(value);
  return combine(geometries.flatMap(polygonsOf));
}
