"use client";

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { addZoneLayers, createMap, type MapZone } from "@/components/domain/zone-map";
import { bounds } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { OpsSnapshot } from "@/server/queries/rides";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function pointCollection(items: { lat: number; lng: number; props: Record<string, unknown> }[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((i) => ({
      type: "Feature" as const,
      properties: i.props,
      geometry: { type: "Point" as const, coordinates: [i.lng, i.lat] },
    })),
  };
}

function toData(snapshot: OpsSnapshot) {
  return {
    drivers: pointCollection(snapshot.drivers.map((d) => ({ lat: d.lat, lng: d.lng, props: { name: d.name, availability: d.availability } }))),
    requests: pointCollection(snapshot.requests.map((r) => ({ lat: r.lat, lng: r.lng, props: { id: r.id } }))),
    trips: {
      type: "FeatureCollection" as const,
      features: snapshot.trips.map((t) => ({
        type: "Feature" as const,
        properties: { status: t.status },
        geometry: {
          type: "LineString" as const,
          coordinates: [[t.pickup.lng, t.pickup.lat], [t.destination.lng, t.destination.lat]],
        },
      })),
    },
  };
}

/** Drivers (green online / blue on trip), waiting requests (amber), and trip legs. Updates in place. */
export function LiveMap({ snapshot, zones, label, className }: { snapshot: OpsSnapshot; zones: MapZone[]; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const latest = useRef(snapshot);

  function apply(map: MapLibreMap, s: OpsSnapshot) {
    const data = toData(s);
    (map.getSource("drivers") as GeoJSONSource | undefined)?.setData(data.drivers);
    (map.getSource("requests") as GeoJSONSource | undefined)?.setData(data.requests);
    (map.getSource("trips") as GeoJSONSource | undefined)?.setData(data.trips);
  }

  // Rebuild only when the zones change (a page refresh passes equal zones in a new array; rebuilding blinks).
  const zonesKey = JSON.stringify(zones);

  useEffect(() => {
    const zones = JSON.parse(zonesKey) as MapZone[];
    if (!ref.current) return;
    let disposed = false;
    createMap(ref.current).then((m) => {
      if (disposed) return m.remove();
      mapRef.current = m;
      m.on("load", () => {
        if (zones.length) addZoneLayers(m, "zones", zones, true);
        m.addSource("trips", { type: "geojson", data: EMPTY });
        m.addLayer({ id: "trips-line", type: "line", source: "trips", paint: { "line-color": "#2563eb", "line-width": 2, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
        m.addSource("requests", { type: "geojson", data: EMPTY });
        m.addLayer({ id: "requests-halo", type: "circle", source: "requests", paint: { "circle-radius": 14, "circle-color": "#f59e0b", "circle-opacity": 0.25 } });
        m.addLayer({ id: "requests-dot", type: "circle", source: "requests", paint: { "circle-radius": 7, "circle-color": "#f59e0b", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
        m.addSource("drivers", { type: "geojson", data: EMPTY });
        m.addLayer({
          id: "drivers-dot",
          type: "circle",
          source: "drivers",
          paint: {
            "circle-radius": 6,
            "circle-color": ["match", ["get", "availability"], "on_trip", "#2563eb", "#059669"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        readyRef.current = true;
        apply(m, latest.current);
        const b = bounds(zones.map((z) => z.boundary));
        if (b) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 13 });
      });
    });
    return () => {
      disposed = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once; data flows through apply() below.
  }, [zonesKey]);

  useEffect(() => {
    latest.current = snapshot; // read by the map's load handler
    if (readyRef.current && mapRef.current) apply(mapRef.current, snapshot);
  }, [snapshot]);

  return <div ref={ref} className={cn("relative isolate h-[520px] w-full overflow-hidden rounded-lg border", className)} role="img" aria-label={label} />;
}
