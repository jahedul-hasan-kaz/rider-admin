"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { Eraser, MousePointer2, Pencil, TriangleAlert, Upload } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { TerraDraw } from "terra-draw";
import { toast } from "sonner";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { addZoneLayers, createMap, type MapZone } from "@/components/domain/zone-map";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { areaKm2, bounds, combine, parseZoneGeoJson, polygonsOf, type Polygon, type ZoneGeometry } from "@/lib/geo";
import { saveZone } from "@/server/actions/supply";
import type { Zone } from "@/server/queries/supply";

type Props = { zone: Zone | null; otherZones: MapZone[]; canEdit: boolean };

/**
 * Zone boundary editor (docs/spec/06-admin-ui.md §5.9): draw or edit polygons
 * with terra-draw, upload GeoJSON, live area readout, overlap warnings from
 * the server, and the previous boundary shown dashed while editing.
 */
export function ZoneEditor({ zone, otherZones, canEdit }: Props) {
  const t = useTranslations("zones");
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [geometry, setGeometry] = useState<ZoneGeometry | null>((zone?.boundary as ZoneGeometry | undefined) ?? null);
  const [mode, setMode] = useState<"polygon" | "select" | "static">(canEdit ? (zone ? "select" : "polygon") : "static");
  const [code, setCode] = useState(zone?.code ?? "");
  const [name, setName] = useState(zone?.name ?? "");
  const [active, setActive] = useState(zone?.active ?? false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;
    if (!container.current) return;

    createMap(container.current).then((m) => {
      if (disposed) return m.remove();
      map = m;
      m.on("load", async () => {
        if (otherZones.length) addZoneLayers(m, "others", otherZones, true);
        if (zone) {
          m.addSource("previous", { type: "geojson", data: { type: "Feature", properties: {}, geometry: zone.boundary as ZoneGeometry } });
          m.addLayer({
            id: "previous-line",
            type: "line",
            source: "previous",
            paint: { "line-color": "#71717a", "line-width": 1.5, "line-dasharray": [3, 2] },
          });
        }
        const b = bounds([...(zone ? [zone.boundary as ZoneGeometry] : []), ...otherZones.map((z) => z.boundary)]);
        if (b) m.fitBounds(b, { padding: 60, duration: 0, maxZoom: 13 });
        if (!canEdit) return;

        const { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } = await import("terra-draw");
        const { TerraDrawMapLibreGLAdapter } = await import("terra-draw-maplibre-gl-adapter");
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
          modes: [
            new TerraDrawPolygonMode({
              styles: { fillColor: "#059669", outlineColor: "#047857", fillOpacity: 0.2, outlineWidth: 2 },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
              },
            }),
          ],
        });
        draw.start();
        if (zone) {
          draw.addFeatures(
            polygonsOf(zone.boundary as ZoneGeometry).map((p) => ({
              id: crypto.randomUUID(),
              type: "Feature" as const,
              properties: { mode: "polygon" },
              geometry: p,
            })),
          );
        }
        draw.setMode(zone ? "select" : "polygon");
        draw.on("change", () => {
          const polygons = draw
            .getSnapshot()
            .filter((f) => f.geometry.type === "Polygon" && f.properties.mode === "polygon")
            .map((f) => f.geometry as Polygon)
            .filter((p) => (p.coordinates[0]?.length ?? 0) >= 4);
          setGeometry(combine(polygons));
        });
        drawRef.current = draw;
      });
    });

    return () => {
      disposed = true;
      drawRef.current?.stop();
      drawRef.current = null;
      map?.remove();
    };
  }, [zone, otherZones, canEdit]);

  function switchMode(next: "polygon" | "select") {
    drawRef.current?.setMode(next);
    setMode(next);
  }

  function clear() {
    drawRef.current?.clear();
    setGeometry(null);
    switchMode("polygon");
  }

  async function upload(file: File) {
    setFileError(null);
    const parsed = parseZoneGeoJson(await file.text());
    if (!parsed) {
      setFileError(t("badFile"));
      return;
    }
    const draw = drawRef.current;
    if (draw) {
      draw.clear();
      draw.addFeatures(
        polygonsOf(parsed).map((p) => ({ id: crypto.randomUUID(), type: "Feature" as const, properties: { mode: "polygon" }, geometry: p })),
      );
      switchMode("select");
    }
    setGeometry(parsed);
  }

  const area = geometry ? areaKm2(geometry) : 0;
  const valid = Boolean(geometry && name.trim() && (zone || /^[a-z][a-z0-9_]{1,40}$/.test(code)));

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card className="h-fit">
        <CardContent className="pt-6">
          <FieldGroup>
            {!zone ? (
              <Field>
                <FieldLabel htmlFor="z-code">{t("code")}</FieldLabel>
                <Input id="z-code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="dhaka_core" disabled={!canEdit} />
                <FieldDescription>{t("codeHelp")}</FieldDescription>
              </Field>
            ) : (
              <p className="text-sm">
                {t("code")}: <code>{zone.code}</code>
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="z-name">{t("name")}</FieldLabel>
              <Input id="z-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!canEdit} />
            </Field>
            <label htmlFor="z-active" className="flex items-center gap-3 text-sm">
              <Switch id="z-active" checked={active} onCheckedChange={setActive} disabled={!canEdit} />
              {t("activeLabel")}
            </label>
            <p className="text-sm font-medium tabular" aria-live="polite">
              {geometry ? t("area", { area: area.toLocaleString(undefined, { maximumFractionDigits: 2 }) }) : t("noShape")}
            </p>
            {overlaps.length ? (
              <Alert>
                <TriangleAlert className="size-4" />
                <AlertDescription>{t("overlapWarning", { names: overlaps.join(", ") })}</AlertDescription>
              </Alert>
            ) : null}
            {fileError ? (
              <Alert variant="destructive">
                <AlertDescription>{fileError}</AlertDescription>
              </Alert>
            ) : null}
            {canEdit ? (
              <Button disabled={!valid} onClick={() => setConfirming(true)}>
                {t("save")}
              </Button>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={mode === "polygon" ? "default" : "outline"} size="sm" onClick={() => switchMode("polygon")}>
              <Pencil className="size-3.5" />
              {t("draw")}
            </Button>
            <Button variant={mode === "select" ? "default" : "outline"} size="sm" onClick={() => switchMode("select")}>
              <MousePointer2 className="size-3.5" />
              {t("editShape")}
            </Button>
            <Button variant="outline" size="sm" onClick={clear}>
              <Eraser className="size-3.5" />
              {t("clear")}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="size-3.5" />
                {t("upload")}
                <input
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <span className="text-xs text-muted-foreground">{mode === "polygon" ? t("drawHint") : null}</span>
          </div>
        ) : null}
        <div ref={container} className="h-[560px] w-full overflow-hidden rounded-lg border" data-testid="zone-map" />
      </div>

      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("saveTitle", { name: name || code })}
        description={t("saveBody")}
        confirmLabel={t("save")}
        presets={["Pilot launch zone", "Extend coverage to new area", "Boundary correction"]}
        successMessage={t("saved")}
        onConfirm={async (reason) => {
          const result = await saveZone({
            id: zone?.id ?? null,
            code: zone?.code ?? code,
            name,
            geometry: geometry!,
            active,
            expectedVersion: zone?.version ?? null,
            reason,
          });
          if (result.ok) {
            setOverlaps(result.data.overlaps.map((o) => o.name));
            if (result.data.overlaps.length) toast.warning(t("overlapWarning", { names: result.data.overlaps.map((o) => o.name).join(", ") }));
          }
          return result;
        }}
        onSuccess={() => {
          if (!zone) router.push("/zones" as Route);
          router.refresh();
        }}
      />
    </div>
  );
}
