"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { publicEnv } from "@/lib/env.public";
import { bounds, DHAKA, type ZoneGeometry } from "@/lib/geo";
import { cn } from "@/lib/utils";

export type MapZone = { id: string; name: string; active: boolean; boundary: ZoneGeometry };

/** Creates a MapLibre map on the client only (WebGL; no SSR). */
export async function createMap(container: HTMLElement): Promise<MapLibreMap> {
  const maplibregl = await import("maplibre-gl"); // v6: named ESM exports only
  // Worker served from our origin (scripts/copy-vendor.mjs); the bundler can't resolve MapLibre's own.
  maplibregl.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibregl.getVersion()}.mjs`);
  const map = new maplibregl.Map({
    container,
    style: publicEnv.NEXT_PUBLIC_MAP_STYLE_URL,
    center: DHAKA,
    zoom: 10.5,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  // MapLibre measures its container once. When the container changes size later (sidebar toggled, window resized,
  // layout settling) the canvas would keep its old pixel width and spill over its neighbours, so follow the container.
  const observer = new ResizeObserver(() => map.resize());
  observer.observe(container);
  map.on("remove", () => observer.disconnect());
  return map;
}

export function zonesFeatureCollection(zones: MapZone[]) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => ({
      type: "Feature" as const,
      id: z.id,
      properties: { name: z.name, active: z.active },
      geometry: z.boundary,
    })),
  };
}

/** Adds read-only zone outlines: active zones green, inactive grey and dashed. */
export function addZoneLayers(map: MapLibreMap, sourceId: string, zones: MapZone[], muted = false) {
  map.addSource(sourceId, { type: "geojson", data: zonesFeatureCollection(zones) });
  map.addLayer({
    id: `${sourceId}-fill`,
    type: "fill",
    source: sourceId,
    paint: {
      "fill-color": ["case", ["get", "active"], "#059669", "#71717a"],
      "fill-opacity": muted ? 0.05 : 0.15,
    },
  });
  map.addLayer({
    id: `${sourceId}-line`,
    type: "line",
    source: sourceId,
    paint: {
      "line-color": ["case", ["get", "active"], "#059669", "#71717a"],
      "line-width": muted ? 1 : 2,
      "line-dasharray": ["case", ["get", "active"], ["literal", [1, 0]], ["literal", [2, 2]]],
    },
  });
}

/** Overview map of all zones (Zones list page). */
export function ZoneMap({ zones, className }: { zones: MapZone[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Rebuild only when the zones change (a page refresh passes equal zones in a new array; rebuilding blinks).
  const zonesKey = JSON.stringify(zones);

  useEffect(() => {
    const zones = JSON.parse(zonesKey) as MapZone[];
    let map: MapLibreMap | undefined;
    let disposed = false;
    if (!ref.current) return;
    createMap(ref.current).then((m) => {
      if (disposed) return m.remove();
      map = m;
      m.on("load", () => {
        addZoneLayers(m, "zones", zones);
        const b = bounds(zones.map((z) => z.boundary));
        if (b) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 13 });
      });
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [zonesKey]);

  return <div ref={ref} className={cn("relative isolate h-80 w-full overflow-hidden rounded-lg border", className)} role="img" aria-label="Map of service zones" />;
}
