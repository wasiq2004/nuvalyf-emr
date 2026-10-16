import { eq, sql } from "drizzle-orm";
import { withAppConnection } from "@/lib/db";
import { heartbeats } from "@/lib/db/schema";
import { describeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** The worker runs a pass a minute; older than this means it has stopped. */
const WORKER_STALE_SECONDS = 5 * 60;

/**
 * Liveness + readiness for load balancers and Docker. 503 only when the
 * database is unreachable; a stopped worker is reported (for alerting) but
 * does not take the web app out of rotation. No internal detail is exposed.
 */
export async function GET() {
  try {
    const worker = await withAppConnection(async (db) => {
      await db.execute(sql`select 1`);
      const [beat] = await db.select({ beatAt: heartbeats.beatAt }).from(heartbeats).where(eq(heartbeats.name, "worker")).limit(1);
      return beat ? Math.round((Date.now() - beat.beatAt.getTime()) / 1000) : null;
    });
    return Response.json({
      status: "ok",
      database: "ok",
      worker: worker === null ? "never-seen" : worker > WORKER_STALE_SECONDS ? "stale" : "ok",
      workerLastSeenSeconds: worker,
    });
  } catch (error) {
    console.error("[health] database check failed:", describeError(error));
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
