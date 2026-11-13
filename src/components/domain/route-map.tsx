"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { createMap } from "@/components/domain/zone-map";
import { cn } from "@/lib/utils";

type Point = { lat: number; lng: number };

/** Pickup, destination and the recorded GPS trail of one trip (trips.view_location only). */
export function RouteMap({
  pickup,
  destination,
  trail,
  className,
}: {
  pickup: Point | null;
  destination: Point | null;
  trail: [number, number][] | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Rebuild only when the route itself changes: a page refresh hands over equal data in new objects, and
  // rebuilding the map for that makes it blink.
  const dataKey = JSON.stringify([pickup, destination, trail]);

  useEffect(() => {
    if (!ref.current) return;
    const [pickup, destination, trail] = JSON.parse(dataKey) as [Point | null, Point | null, [number, number][] | null];
    let map: MapLibreMap | undefined;
    let disposed = false;
    createMap(ref.current).then((m) => {
      if (disposed) return m.remove();
      map = m;
      m.on("load", () => {
        const points: [number, number][] = [];
        if (trail && trail.length > 1) {
          m.addSource("trail", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: trail } } });
          m.addLayer({ id: "trail-line", type: "line", source: "trail", paint: { "line-color": "#2563eb", "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } });
          points.push(...trail);
        }
        const markers = [
          pickup ? { p: pickup, color: "#059669", name: "pickup" } : null,
          destination ? { p: destination, color: "#dc2626", name: "destination" } : null,
        ].filter((x): x is { p: Point; color: string; name: string } => Boolean(x));
        if (markers.length) {
          m.addSource("ends", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: markers.map((x) => ({
                type: "Feature" as const,
                properties: { color: x.color },
                geometry: { type: "Point" as const, coordinates: [x.p.lng, x.p.lat] },
              })),
            },
          });
          m.addLayer({
            id: "ends-circle",
            type: "circle",
            source: "ends",
            paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
          });
          points.push(...markers.map((x): [number, number] => [x.p.lng, x.p.lat]));
        }
        if (points.length) {
          const xs = points.map((p) => p[0]);
          const ys = points.map((p) => p[1]);
          m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 50, duration: 0, maxZoom: 15 });
        }
      });
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [dataKey]);

  return <div ref={ref} className={cn("relative isolate h-80 w-full overflow-hidden rounded-lg border", className)} role="img" aria-label="Trip route" />;
}
