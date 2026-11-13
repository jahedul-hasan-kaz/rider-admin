import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppError } from "@/server/http/errors";
import { getSharedTrip, type SharedTrip } from "@/server/services/trip-share";

// Public trip share page (rider-passenger gap B5). Opened from a link a passenger sent to family or friends: who is
// driving, which vehicle, where they are heading, and the driver's last position. No sign-in, no phone numbers, no
// passenger identity. Refreshes itself every 15 seconds with plain HTML (no scripts, so it works under the CSP).

export const metadata: Metadata = {
  title: "Shared trip",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const ACTIVE = new Set(["driver_assigned", "driver_arriving", "arrived", "in_progress"]);

const STATUS: Record<string, string> = {
  driver_assigned: "Driver on the way to pickup",
  driver_arriving: "Driver on the way to pickup",
  arrived: "Driver at the pickup point",
  in_progress: "On the way",
  completed: "Arrived",
  cancelled_by_passenger: "Ride cancelled",
  cancelled_by_driver: "Ride cancelled",
  cancelled_by_admin: "Ride ended",
  failed: "Ride ended",
};

function minutesAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

export default async function SharedTripPage(props: PageProps<"/share/[token]">) {
  const { token } = await props.params;
  let trip: SharedTrip;
  try {
    trip = await getSharedTrip(token);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const active = ACTIVE.has(trip.status);
  const v = trip.vehicle;
  const vehicle = [v.color, v.make, v.model].filter(Boolean).join(" ");
  const loc = trip.driver_location;
  const mapUrl = loc ? `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=16/${loc.lat}/${loc.lng}` : null;
  // eslint-disable-next-line react-hooks/purity -- server component, rendered once per request
  const now = Date.now();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 bg-background p-6">
      {active ? <meta httpEquiv="refresh" content="15" /> : null}
      <header className="rounded-3xl bg-[#0B3B2E] p-6 text-[#E8F5EE]">
        <p className="text-sm opacity-80">Shared trip</p>
        <h1 className="mt-1 text-2xl font-extrabold">{STATUS[trip.status] ?? "Trip update"}</h1>
        {trip.destination_label ? <p className="mt-2 text-sm opacity-90">Heading to {trip.destination_label}</p> : null}
      </header>

      <section className="rounded-2xl border p-5">
        <p className="text-sm text-muted-foreground">Vehicle</p>
        <p className="mt-1 text-2xl font-extrabold tracking-wide tabular-nums">{v.registration_number}</p>
        <p className="text-sm text-muted-foreground">{vehicle}</p>
        {trip.driver_first_name ? <p className="mt-3 font-semibold">Driver: {trip.driver_first_name}</p> : null}
      </section>

      {loc && active ? (
        <section className="rounded-2xl border p-5">
          <p className="text-sm text-muted-foreground">Driver&apos;s last position · updated {minutesAgo(loc.updated_at, now)}</p>
          <a className="mt-2 inline-block font-semibold underline" href={mapUrl!} rel="noopener noreferrer" target="_blank">
            Open in map
          </a>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {active
          ? "This page refreshes every 15 seconds. The link stops working an hour after the trip ends."
          : "This trip has ended. The link stops working an hour after the trip ends."}
      </p>
      <p className="text-xs text-muted-foreground">
        In an emergency call <a className="font-semibold underline" href="tel:999">999</a>.
      </p>
    </main>
  );
}
