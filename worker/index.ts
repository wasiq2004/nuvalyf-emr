// NuvaLyf background worker: appointment reminders and WhatsApp broadcasts.
//
//   npm run worker            run forever (one pass a minute)
//   npm run worker -- --once  one pass, then exit (cron, debugging)
//
// Only one worker does the work at a time (Postgres advisory lock), so it is
// safe to run several replicas. Uses the app role: row-level security applies.
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const LOCK_KEY = 7_310_042;
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

async function main() {
  const { runMessagingTick } = await import("../features/messaging/worker");
  const once = process.argv.includes("--once");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // A dedicated connection holds the lock for as long as this process lives.
  const lockConnection = postgres(url, { max: 1, onnotice: () => {} });
  let leader = false;
  let stopping = false;
  const stop = async () => {
    stopping = true;
    await lockConnection.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    if (!leader) {
      const [row] = await lockConnection`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
      leader = Boolean(row?.ok);
      if (!leader) console.info("[worker] another worker is active; standing by");
    }
    if (leader) {
      const started = Date.now();
      try {
        const result = await runMessagingTick();
        if (result.queued || result.sent || result.failed || result.skipped || result.errors.length) {
          console.info(`[worker] clinics=${result.clinics} queued=${result.queued} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} (${Date.now() - started} ms)`);
        }
        for (const error of result.errors) console.error(`[worker] ${error}`);
      } catch (error) {
        // Never log query parameters (they can carry patient data).
        console.error("[worker] pass failed:", (error instanceof Error ? error.message : String(error)).split(/\n\s*params:/i)[0]);
      }
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  await lockConnection.end({ timeout: 5 });
  process.exit(0);
}

main().catch((error) => {
  console.error("[worker] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
