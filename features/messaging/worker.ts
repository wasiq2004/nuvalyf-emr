import "server-only";

// One pass of the background worker: for every active clinic with the
// WhatsApp module, queue due appointment reminders and send what is queued.
// Each clinic runs in its own RLS-scoped transaction, as the app role.
import { sql } from "drizzle-orm";
import { withAppConnection, withClinic } from "@/lib/db";
import { heartbeats } from "@/lib/db/schema";
import { describeError } from "@/lib/errors";
import { enqueueDueReminders, processQueue, type Sender } from "./messaging.service";

export type TickResult = { clinics: number; queued: number; sent: number; failed: number; skipped: number; errors: string[] };

export async function runMessagingTick(now = new Date(), sender?: Sender): Promise<TickResult> {
  const clinics = (await withAppConnection((db) =>
    db.execute(sql`
      select c.id from platform.clinics c
      join platform.plan_modules pm on pm.plan_id = c.plan_id
      where c.status = 'active' and pm.module = 'whatsapp'`),
  )) as unknown as { id: string }[];

  const total: TickResult = { clinics: clinics.length, queued: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  for (const clinic of clinics) {
    try {
      await withClinic({ clinicId: clinic.id }, async (tx) => {
        total.queued += await enqueueDueReminders(tx, clinic.id, now);
        const stats = await processQueue(tx, clinic.id, sender);
        total.sent += stats.sent;
        total.failed += stats.failed;
        total.skipped += stats.skipped;
      });
    } catch (error) {
      // One clinic's problem (e.g. a bad token) must not stop the others.
      total.errors.push(`${clinic.id}: ${describeError(error)}`);
    }
  }
  await withAppConnection((db) =>
    db
      .insert(heartbeats)
      .values({ name: "worker", beatAt: now, detail: `clinics=${total.clinics} sent=${total.sent} errors=${total.errors.length}` })
      .onConflictDoUpdate({ target: heartbeats.name, set: { beatAt: now, detail: `clinics=${total.clinics} sent=${total.sent} errors=${total.errors.length}` } }),
  );
  return total;
}
