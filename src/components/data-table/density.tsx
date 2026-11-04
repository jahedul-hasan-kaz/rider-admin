"use client";

import { Rows2, Rows3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const KEY = "rider-admin:density";

function read(): "comfortable" | "compact" {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Table row density, remembered in this browser. Rows read it from the data-density attribute on <html>. */
export function DensityToggle() {
  const t = useTranslations("views");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  useEffect(() => {
    const saved = read();
    // Reading the stored preference after mount is the point: the server cannot know it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensity(saved);
    document.documentElement.dataset.density = saved;
  }, []);

  function toggle() {
    const next = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    document.documentElement.dataset.density = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage can be unavailable; the choice still applies until the page reloads.
    }
  }

  const Icon = density === "compact" ? Rows3 : Rows2;
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-pressed={density === "compact"} aria-label={t("density")} title={density === "compact" ? t("comfortable") : t("compact")}>
      <Icon className="size-4" />
    </Button>
  );
}
