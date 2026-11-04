import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, formatMoney } from "@/lib/format";

describe("formatMoney", () => {
  it("formats taka with two decimals", () => {
    expect(formatMoney(1250)).toBe("৳1,250.00");
    expect(formatMoney("180.5")).toBe("৳180.50");
  });
  it("shows a dash for missing or invalid values", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("abc")).toBe("—");
  });
});

describe("formatDistance / formatDuration", () => {
  it.each([[850, "850 m"], [3400, "3.4 km"], [null, "—"]])("%s -> %s", (m, out) => expect(formatDistance(m as number | null)).toBe(out));
  it.each([[45, "45 s"], [750, "12 min 30 s"], [600, "10 min"], [5400, "1 h 30 min"], [null, "—"]])("%s -> %s", (s, out) =>
    expect(formatDuration(s as number | null)).toBe(out));
});
