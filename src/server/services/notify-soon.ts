import "server-only";
import { after } from "next/server";
import { log } from "@/server/log";
import { runNotifyJob } from "@/server/services/notify";

/**
 * Sends queued notifications right after the response, instead of waiting for the scheduled worker. Used where a
 * passenger is waiting for news (driver found, arrived, trip started or finished). The scheduled job still retries
 * anything that fails here.
 */
export function deliverNotificationsSoon(): void {
  after(() => runNotifyJob(20).catch((err: unknown) => log.warn({ err }, "immediate notification delivery failed")));
}
