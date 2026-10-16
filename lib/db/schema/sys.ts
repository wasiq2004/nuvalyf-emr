import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { sysSchema } from "./_shared";

/** Fixed-window counters shared by every app instance. */
export const rateLimits = sysSchema.table("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

/** Background processes report in here; /api/health shows how long ago. */
export const heartbeats = sysSchema.table("heartbeats", {
  name: text("name").primaryKey(),
  beatAt: timestamp("beat_at", { withTimezone: true }).notNull(),
  detail: text("detail"),
});
