import { describe, expect, it } from "vitest";
import { areaKm2, combine, parseZoneGeoJson, type Polygon } from "@/lib/geo";

// Roughly 0.2° × 0.2° box around Dhaka (~ 21.4 km × 22.2 km).
const box: Polygon = {
  type: "Polygon",
  coordinates: [[[90.3, 23.7], [90.5, 23.7], [90.5, 23.9], [90.3, 23.9], [90.3, 23.7]]],
};

describe("areaKm2", () => {
  it("matches the PostGIS geography area within 1%", () => {
    // PostGIS (ellipsoidal) reports 451.5 km² for this box; the sphere differs slightly.
    expect(Math.abs(areaKm2(box) - 451.5) / 451.5).toBeLessThan(0.01);
  });

  it("adds the parts of a multipolygon", () => {
    const multi = combine([box, box])!;
    expect(areaKm2(multi)).toBeCloseTo(areaKm2(box) * 2, 3);
  });
});

describe("parseZoneGeoJson", () => {
  it("accepts a feature collection", () => {
    const text = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: box }] });
    expect(parseZoneGeoJson(text)?.type).toBe("Polygon");
  });

  it("merges several polygons into a multipolygon", () => {
    const text = JSON.stringify({ type: "FeatureCollection", features: [box, box].map((g) => ({ type: "Feature", geometry: g })) });
    expect(parseZoneGeoJson(text)?.type).toBe("MultiPolygon");
  });

  it("rejects non-polygons and invalid JSON", () => {
    expect(parseZoneGeoJson(JSON.stringify({ type: "Point", coordinates: [90, 23] }))).toBeNull();
    expect(parseZoneGeoJson("{not json")).toBeNull();
  });
});
