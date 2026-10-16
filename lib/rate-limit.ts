import "server-only";

import { sql } from "drizzle-orm";
import type { Queryable } from "@/lib/db";

/**
 * Fixed-window counter stored in Postgres, so limits hold across every app
 * instance. Returns whether this hit is allowed.
 */
export async function rateLimit(
  db: Queryable,
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<{ allowed: boolean }> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  const [row] = await db.execute<{ count: number }>(sql`
    insert into sys.rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case
        when sys.rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1
        else sys.rate_limits.count + 1
      end,
      window_start = case
        when sys.rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now()
        else sys.rate_limits.window_start
      end
    returning count
  `);

  // Occasionally clear out expired windows.
  if (Math.random() < 0.01) {
    await db.execute(sql`delete from sys.rate_limits where window_start < now() - interval '1 day'`);
  }

  return { allowed: Number(row?.count ?? 0) <= limit };
}
