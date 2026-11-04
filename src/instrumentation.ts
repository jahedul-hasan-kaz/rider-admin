// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { demoDataEnabled, demoSeedEnabled, ensureDemoData, ensureDemoUsers } = await import("@/server/services/seed-demo");
  if (!demoSeedEnabled()) return;
  // Never block or crash startup: a database that is still starting simply means the seed runs on the next start.
  void (async () => {
    await ensureDemoUsers();
    if (demoDataEnabled()) await ensureDemoData();
  })().catch(async (err: unknown) => {
    const { log } = await import("@/server/log");
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "demo seed skipped");
  });
}
